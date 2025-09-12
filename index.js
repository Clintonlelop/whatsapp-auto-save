try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidDecode } = require('@whiskeysockets/baileys');
    const express = require('express');
    const fs = require('fs');
    const path = require('path');
    const fastcsv = require('fast-csv');
    const winston = require('winston');
    const QRCode = require('qrcode');

    const app = express();
    const port = process.env.PORT || 8080;

    // File paths
    const csvFilePath = path.join(__dirname, 'unsaved_contacts.csv');
    const vcfFilePath = path.join(__dirname, 'unsaved_contacts.vcf');
    const jsonFilePath = path.join(__dirname, 'unsaved_contacts.json');
    const qrFilePath = path.join(__dirname, 'qr.png');

    // Config
    const AUTH_TOKEN = process.env.AUTH_TOKEN || 'my-secret-token';
    const MESSAGE_LIMIT = 100;
    const BATCH_SIZE = 10;
    const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`;
    const PHONE_NUMBER = process.env.PHONE_NUMBER || '8012345678'; // Replace with your number, no leading 0 or +234

    // Logger setup
    const logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [
            new winston.transports.File({ filename: 'app.log' }),
            new winston.transports.Console()
        ]
    });

    let status = 'Initializing...';
    let qrCode = '';
    let unsavedContacts = [];
    let phoneSet = new Set();
    let pendingWrites = 0;

    // Auth middleware
    const basicAuth = (req, res, next) => {
        const token = req.query.token;
        if (!token || token !== AUTH_TOKEN) {
            logger.warn('Unauthorized access attempt');
            return res.status(401).send('Unauthorized: Invalid or missing token');
        }
        next();
    };

    async function saveContacts() {
        try {
            fs.writeFileSync(jsonFilePath, JSON.stringify(unsavedContacts, null, 2));
            logger.info(`JSON saved: ${jsonFilePath}`);

            const ws = fs.createWriteStream(csvFilePath);
            fastcsv.write(unsavedContacts, { headers: ['phone', 'name', 'message', 'timestamp'] })
                .pipe(ws)
                .on('finish', () => logger.info(`CSV saved: ${csvFilePath}`));

            let vcfContent = '';
            unsavedContacts.forEach(c => {
                vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL;TYPE=CELL:${c.phone}\nNOTE:From WhatsApp Message: ${c.message}\nEND:VCARD\n`;
            });
            fs.writeFileSync(vcfFilePath, vcfContent.trim());
            logger.info(`VCF saved: ${vcfFilePath}`);
        } catch (err) {
            logger.error('Error saving contacts:', err);
        }
    }

    async function startBot() {
        const { state, saveCreds } = await useMultiFileAuthState('./session', { phoneNumber: PHONE_NUMBER });
        const sock = makeWASocket({
            auth: state,
            syncFullHistory: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                qrCode = qr;
                status = 'QR code generated. Scan at /qr. Pairing code not supported in Baileys 7.0.0-rc.2.';
                logger.info(`QR code generated: ${qr}`);
                try {
                    await QRCode.toFile(qrFilePath, qr, { type: 'png', errorCorrectionLevel: 'H' });
                    logger.info(`QR image saved: ${qrFilePath}`);
                } catch (err) {
                    logger.error('QR image generation failed:', err);
                }
            }
            if (connection === 'open') {
                status = 'Connected! Listening for incoming private messages...';
                qrCode = '';
                if (fs.existsSync(qrFilePath)) fs.unlinkSync(qrFilePath);
                logger.info(status);
            }
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                status = `Disconnected: ${reason || 'Unknown'}`;
                logger.error(status, lastDisconnect?.error || '');
                if (reason === DisconnectReason.loggedOut) {
                    status = 'Logged out. Clear ./session folder and restart.';
                    logger.info(status);
                } else {
                    setTimeout(startBot, 5000);
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                for (const msg of messages) {
                    if (!msg.key.fromMe && msg.key.remoteJid.endsWith('@s.whatsapp.net')) {
                        const remoteJid = msg.key.remoteJid;
                        const phone = jidDecode(remoteJid)?.user || remoteJid.split('@')[0];
                        if (phoneSet.has(phone)) continue;

                        let contact;
                        for (let attempt = 1; attempt <= 3; attempt++) {
                            try {
                                contact = await sock.fetchContactByJid(remoteJid);
                                break;
                            } catch (err) {
                                logger.warn(`Attempt ${attempt} failed to fetch contact ${phone}: ${err}`);
                                if (attempt === 3) {
                                    logger.error(`Failed to fetch contact ${phone} after 3 attempts`);
                                    continue;
                                }
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }

                        if (!contact || (!contact.verifiedName && !contact.name)) {
                            const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || 'No text';
                            const entry = {
                                phone,
                                name: contact?.pushname || contact?.notify || 'Unknown',
                                message: messageText.slice(0, MESSAGE_LIMIT),
                                timestamp: new Date(msg.messageTimestamp * 1000).toISOString()
                            };
                            unsavedContacts.push(entry);
                            phoneSet.add(phone);
                            pendingWrites++;
                            logger.info(`Saved new unsaved number: ${phone} (${entry.name}) - Message: ${entry.message}`);

                            if (pendingWrites >= BATCH_SIZE) {
                                await saveContacts();
                                pendingWrites = 0;
                            }
                        }
                    }
                }
            } catch (err) {
                logger.error('Error processing message:', err);
            }
        });
    }

    // Routes
    app.get('/', (req, res) => res.send(`<p>Status: ${status}</p><p><a href="/pair">View Pairing Code</a> | <a href="/qr">View QR Code</a> | <a href="/downloads">View Downloads</a></p>`));
    app.get('/pair', (req, res) => res.send(`<p>Status: ${status}</p><p>Pairing Code: <strong>Not supported in Baileys 7.0.0-rc.2. Use /qr to scan QR code or update to latest Baileys version.</strong></p><p><a href="/">Back to Status</a></p>`));
    app.get('/qr', (req, res) => {
        if (qrCode) {
            res.send(`<p>Status: ${status}</p><p>Scan QR code at <a href="/download/qr?token=${AUTH_TOKEN}">Download QR Code</a> in WhatsApp (Settings > Linked Devices).</p><p><a href="/">Back to Status</a></p>`);
        } else {
            res.send(`<p>Status: ${status}</p><p>QR Code: Not available yet. Wait for generation or check logs.</p><p><a href="/">Back to Status</a></p>`);
        }
    });
    app.get('/download/qr', basicAuth, (req, res) => {
        if (fs.existsSync(qrFilePath)) {
            res.download(qrFilePath, 'qr.png');
        } else {
            res.status(404).send('QR code not available. Check /qr or logs.');
        }
    });
    app.get('/downloads', (req, res) => {
        const tokenQuery = `?token=${AUTH_TOKEN}`;
        const files = [
            { name: 'CSV (Contacts)', url: `${BASE_URL}/download/csv${tokenQuery}`, path: csvFilePath },
            { name: 'VCF (vCard)', url: `${BASE_URL}/download/vcf${tokenQuery}`, path: vcfFilePath }
        ];
        let html = `<p>Status: ${status}</p><h3>Download Files</h3><ul>`;
        files.forEach(file => {
            if (fs.existsSync(file.path)) {
                html += `<li><a href="${file.url}">${file.name}</a></li>`;
            } else {
                html += `<li>${file.name}: Not available yet</li>`;
            }
        });
        html += '</ul><p><a href="/">Back to Status</a></p>';
        res.send(html);
    });
    app.get('/download/csv', basicAuth, (req, res) => {
        if (fs.existsSync(csvFilePath)) {
            res.download(csvFilePath, 'unsaved_contacts.csv');
        } else {
            res.status(404).send('CSV file not available.');
        }
    });
    app.get('/download/vcf', basicAuth, (req, res) => {
        if (fs.existsSync(vcfFilePath)) {
            res.download(vcfFilePath, 'unsaved_contacts.vcf');
        } else {
            res.status(404).send('VCF file not available.');
        }
    });

    app.listen(port, () => {
        logger.info(`Server running on port ${port}`);
        logger.info(`Base URL: ${BASE_URL}`);
        logger.info(`Phone number for pairing: ${PHONE_NUMBER}`);
        startBot().catch(err => {
            logger.error('Failed to start bot:', err);
            process.exit(1);
        });
    });
} catch (err) {
    console.error('Failed to load modules (check npm install):', err);
    process.exit(1);
}

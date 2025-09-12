const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidDecode } = require('baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const fastcsv = require('fast-csv');

const app = express();
const port = process.env.PORT || 8080;

// File paths
const csvFilePath = path.join(__dirname, 'unsaved_contacts.csv');
const vcfFilePath = path.join(__dirname, 'unsaved_contacts.vcf');
const jsonFilePath = path.join(__dirname, 'unsaved_contacts.json');

let status = 'Initializing...';
let qrCode = '';
let unsavedContacts = [];

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        syncFullHistory: false // Optimize performance
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCode = qr;
            status = 'Scan QR code at /qr';
            console.log('QR CODE:', qr);
        }
        if (connection === 'open') {
            status = 'Connected! Listening for incoming private messages...';
            console.log(status);
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            status = `Disconnected: ${reason || 'Unknown'}`;
            console.error(status, lastDisconnect?.error || '');
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 5000); // Retry after 5s
            } else {
                status = 'Logged out. Clear ./session and restart.';
                console.log(status);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            for (const msg of messages) {
                if (!msg.key.fromMe && msg.key.remoteJid.endsWith('@s.whatsapp.net')) {
                    const remoteJid = msg.key.remoteJid;
                    const phone = jidDecode(remoteJid)?.user || remoteJid.split('@')[0];
                    try {
                        const contact = await sock.fetchContactByJid(remoteJid); // Updated for v7
                        // Check if unsaved (no verifiedName or pushname indicates unsaved)
                        if (!contact.verifiedName && !contact.name) { // Proxy for isMyContact: false
                            const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || 'No text';
                            const entry = {
                                phone,
                                name: contact.pushname || contact.notify || 'Unknown',
                                message: messageText.slice(0, 50), // First 50 chars
                                timestamp: new Date(msg.messageTimestamp * 1000).toISOString()
                            };
                            if (!unsavedContacts.some(c => c.phone === phone)) {
                                unsavedContacts.push(entry);
                                console.log(`Saved: ${phone} (${entry.name})`);

                                // Save JSON
                                fs.writeFileSync(jsonFilePath, JSON.stringify(unsavedContacts, null, 2));

                                // Save CSV
                                const ws = fs.createWriteStream(csvFilePath);
                                fastcsv.write(unsavedContacts, { headers: ['phone', 'name', 'message', 'timestamp'] })
                                    .pipe(ws)
                                    .on('finish', () => console.log(`CSV saved: ${csvFilePath}`));

                                // Save VCF
                                let vcfContent = '';
                                unsavedContacts.forEach(c => {
                                    vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL;TYPE=CELL:${c.phone}\nNOTE:From WhatsApp Message: ${c.message}\nEND:VCARD\n`;
                                });
                                fs.writeFileSync(vcfFilePath, vcfContent.trim());
                                console.log(`VCF saved: ${vcfFilePath}`);

                                status = `Saved ${unsavedContacts.length} contacts. Download: /download/csv or /download/vcf`;
                            }
                        }
                    } catch (contactErr) {
                        console.error('Error fetching contact:', contactErr);
                    }
                }
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });
}

// Routes
app.get('/', (req, res) => res.send(status));
app.get('/qr', (req, res) => res.send(`<p>${status}</p><p>Copy QR from logs: ${qrCode}</p><p>Generate at qrcode-monkey.com</p>`));
app.get('/download/csv', (req, res) => res.download(csvFilePath, 'unsaved_contacts.csv'));
app.get('/download/vcf', (req, res) => res.download(vcfFilePath, 'unsaved_contacts.vcf'));

app.listen(port, () => {
    console.log(`Server on port ${port}`);
    startBot();
});

const makeWASocket = require('@whiskeysockets/baileys').default;
const { useSingleFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Auth state
const { state, saveState } = useSingleFileAuthState('./auth_info.json');

// Contacts storage
const contactsFile = './contacts.json';
let contacts = [];

// Load existing contacts
if (fs.existsSync(contactsFile)) {
    try {
        contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf-8'));
    } catch (e) {
        console.log('Error loading contacts:', e.message);
        contacts = [];
    }
}

// Initialize WhatsApp socket
const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
});

// Handle connection updates
sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== 401;
        if (shouldReconnect) {
            console.log('Reconnecting...');
        }
    } else if (connection === 'open') {
        console.log('WhatsApp bot is connected!');
    }
});

// Handle incoming messages
sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe && msg.message) {
        const sender = msg.key.remoteJid;
        if (sender.endsWith('@s.whatsapp.net')) {
            const number = sender.replace('@s.whatsapp.net', '');
            const pushName = msg.pushName || 'Unknown';

            // Check if contact already exists
            const existingContact = contacts.find(c => c.number === number);
            if (!existingContact) {
                // Save new contact
                const newContact = { number, pushName, id: uuidv4() };
                contacts.push(newContact);
                
                // Update contacts.json
                fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2));
                console.log(`New contact saved: ${pushName} (${number})`);
                
                // Generate updated VCF
                generateVCF();
            }
        }
    }
});

// Simple vCard generator
function generateVCF() {
    let vcards = '';
    
    contacts.forEach(contact => {
        vcards += `BEGIN:VCARD
VERSION:3.0
FN:${contact.pushName}
TEL;TYPE=CELL:${contact.number}
END:VCARD\n`;
    });

    fs.writeFileSync('contacts.vcf', vcards);
    console.log('contacts.vcf updated with', contacts.length, 'contacts');
}

// Express server for serving VCF
app.get('/contacts.vcf', (req, res) => {
    const password = req.query.pass;
    
    if (password !== 'lelop') {
        return res.status(401).send('Unauthorized: Invalid password');
    }
    
    // Generate VCF if file doesn't exist
    if (!fs.existsSync('contacts.vcf') && contacts.length > 0) {
        generateVCF();
    }
    
    const filePath = path.join(__dirname, 'contacts.vcf');
    res.download(filePath, 'whatsapp_contacts.vcf', (err) => {
        if (err) {
            console.error('Download error:', err);
            res.status(500).send('Error downloading file');
        }
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running! Use /contacts.vcf?pass=lelop to download contacts');
});

// Generate initial VCF if contacts exist
if (contacts.length > 0) {
    generateVCF();
}

// Start Express server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Download contacts at: http://localhost:${PORT}/contacts.vcf?pass=lelop`);
});

// Save state periodically
setInterval(() => {
    saveState();
}, 10000);

const { default: makeWASocket, useSingleFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// PROPER auth state with stable version
const { state, saveState } = useSingleFileAuthState('./auth_info.json');

// Contacts storage
const CONTACTS_FILE = './contacts.json';
let contacts = [];

try {
    if (fs.existsSync(CONTACTS_FILE)) {
        const contactsData = fs.readFileSync(CONTACTS_FILE, 'utf8');
        contacts = JSON.parse(contactsData);
        console.log(`✅ Loaded ${contacts.length} existing contacts`);
    }
} catch (error) {
    console.log('❌ No existing contacts found');
}

// Initialize WhatsApp socket
const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: { level: 'silent' }
});

// Handle QR code
sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    
    if (qr) {
        console.log('🔐 Scan this QR code with WhatsApp:');
        qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully!');
    }
});

// Save auth state
sock.ev.on('creds.update', saveState);

// Handle messages
sock.ev.on('messages.upsert', ({ messages }) => {
    try {
        const message = messages[0];
        
        if (!message.key.fromMe && message.message) {
            const sender = message.key.remoteJid;
            
            if (sender.endsWith('@s.whatsapp.net')) {
                const number = sender.replace('@s.whatsapp.net', '');
                const pushName = message.pushName || 'Unknown Contact';
                
                // Check if contact already exists
                const contactExists = contacts.some(contact => contact.number === number);
                
                if (!contactExists) {
                    const newContact = {
                        id: uuidv4(),
                        number: number,
                        pushName: pushName,
                        timestamp: new Date().toISOString()
                    };
                    
                    contacts.push(newContact);
                    
                    // Save contacts to file
                    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
                    console.log(`📞 New contact: ${pushName} (${number})`);
                    
                    // Generate updated VCF file
                    generateVCF();
                }
            }
        }
    } catch (error) {
        console.log('❌ Error processing message');
    }
});

// Generate VCF
function generateVCF() {
    try {
        let vcfContent = '';
        
        contacts.forEach(contact => {
            vcfContent += `BEGIN:VCARD
VERSION:3.0
FN:${contact.pushName.replace(/[^\w\s]/gi, ' ').trim()}
TEL;TYPE=CELL:${contact.number}
END:VCARD\n`;
        });
        
        fs.writeFileSync('./contacts.vcf', vcfContent);
        console.log(`📇 VCF updated with ${contacts.length} contacts`);
        
    } catch (error) {
        console.log('❌ Error generating VCF');
    }
}

// Express server
app.get('/contacts.vcf', (req, res) => {
    try {
        if (req.query.pass !== 'lelop') {
            return res.status(401).send('Invalid password. Use ?pass=lelop');
        }
        
        if (!fs.existsSync('./contacts.vcf') && contacts.length > 0) {
            generateVCF();
        }
        
        res.download('./contacts.vcf', 'whatsapp_contacts.vcf');
        
    } catch (error) {
        res.status(500).send('Server error');
    }
});

app.get('/', (req, res) => {
    res.send(`
        <h1>WhatsApp Bot is running! ✅</h1>
        <p>Total contacts: ${contacts.length}</p>
        <p><a href="/contacts.vcf?pass=lelop">Download Contacts VCF</a></p>
    `);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    
    if (contacts.length > 0) {
        generateVCF();
    }
});

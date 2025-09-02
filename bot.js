import makeWASocket from '@whiskeysockets/baileys';
import express from 'express';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3000;

// PROPER auth state structure for Baileys
let authState = { 
    creds: {
        noiseKey: null,
        signedIdentityKey: null,
        signedPreKey: null,
        registrationId: null,
        advSecretKey: null,
        nextPreKeyId: null,
        firstUnuploadedPreKeyId: null,
        serverHasPreKeys: null,
        account: null,
        me: null,
        signalIdentities: null,
        platform: null,
        processedHistoryMessages: null,
        accountSettings: null,
        deviceId: null
    } 
};

const AUTH_FILE = './auth_info.json';

// Load existing auth PROPERLY
try {
    if (fs.existsSync(AUTH_FILE)) {
        const authData = fs.readFileSync(AUTH_FILE, 'utf8');
        const savedCreds = JSON.parse(authData);
        
        // Merge saved credentials with proper structure
        authState.creds = { ...authState.creds, ...savedCreds };
        console.log('✅ Loaded existing authentication');
    } else {
        console.log('🆕 No existing auth found - fresh start');
    }
} catch (error) {
    console.log('❌ Error loading auth, starting fresh');
}

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

// Simple logger that works with Baileys
const simpleLogger = {
    trace: () => {},
    debug: () => {},
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.log('[WARN]', ...args),
    error: (...args) => console.log('[ERROR]', ...args),
    fatal: (...args) => console.log('[FATAL]', ...args),
    child: () => simpleLogger
};

// Initialize WhatsApp socket with PROPER auth structure
const sock = makeWASocket.default({
    auth: authState.creds, // Pass the creds directly
    printQRInTerminal: false,
    logger: simpleLogger
});

// Handle QR code generation
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

// Save authentication state PROPERLY
sock.ev.on('creds.update', (creds) => {
    try {
        fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
        console.log('💾 Authentication state saved');
    } catch (error) {
        console.log('❌ Failed to save auth state');
    }
});

// Handle incoming messages
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

// Generate VCF file function
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

// Express server routes
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

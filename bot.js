import makeWASocket from '@whiskeysockets/baileys';
import express from 'express';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3000;

// Auth state management
let authState = { creds: null };
const AUTH_FILE = './auth_info.json';

// Load existing auth
try {
    if (fs.existsSync(AUTH_FILE)) {
        const authData = fs.readFileSync(AUTH_FILE, 'utf8');
        authState.creds = JSON.parse(authData);
        console.log('✅ Loaded existing authentication');
    }
} catch (error) {
    console.log('❌ No existing auth found or invalid auth file');
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

// Initialize WhatsApp socket
const sock = makeWASocket.default({
    auth: authState.creds,
    printQRInTerminal: false, // We'll handle QR manually
    logger: { level: 'silent' } // Reduce logs for Railway
});

// Handle QR code generation
sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    
    if (qr) {
        console.log('🔐 Scan this QR code with WhatsApp:');
        qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully!');
        console.log('🤖 Bot is now listening for messages...');
    }
    
    if (connection === 'close') {
        console.log('❌ Connection closed, please restart the bot');
    }
});

// Save authentication state
sock.ev.on('creds.update', (creds) => {
    authState.creds = creds;
    try {
        fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
        console.log('💾 Authentication state saved');
    } catch (error) {
        console.log('❌ Failed to save auth state:', error.message);
    }
});

// Handle incoming messages
sock.ev.on('messages.upsert', async ({ messages }) => {
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
                    console.log(`📞 New contact saved: ${pushName} (${number})`);
                    
                    // Generate updated VCF file
                    generateVCF();
                }
            }
        }
    } catch (error) {
        console.log('❌ Error processing message:', error.message);
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
NOTE:Saved via WhatsApp Bot
END:VCARD\n\n`;
        });
        
        fs.writeFileSync('./contacts.vcf', vcfContent);
        console.log(`📇 VCF file updated with ${contacts.length} contacts`);
        
    } catch (error) {
        console.log('❌ Error generating VCF:', error.message);
    }
}

// Express server routes
app.get('/contacts.vcf', (req, res) => {
    try {
        const password = req.query.pass;
        
        if (password !== 'lelop') {
            return res.status(401).json({ 
                error: 'Unauthorized', 
                message: 'Invalid password. Use ?pass=lelop' 
            });
        }
        
        if (!fs.existsSync('./contacts.vcf')) {
            generateVCF();
        }
        
        res.setHeader('Content-Type', 'text/vcard');
        res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_contacts.vcf"');
        
        const vcfData = fs.readFileSync('./contacts.vcf', 'utf8');
        res.send(vcfData);
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Server Error', 
            message: error.message 
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'WhatsApp Bot is running!',
        endpoints: {
            download_contacts: '/contacts.vcf?pass=lelop',
            total_contacts: contacts.length
        }
    });
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📋 Download contacts: http://your-railway-url.railway.app/contacts.vcf?pass=lelop`);
    
    // Generate initial VCF if contacts exist
    if (contacts.length > 0 && !fs.existsSync('./contacts.vcf')) {
        generateVCF();
    }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down gracefully...');
    process.exit(0);
});

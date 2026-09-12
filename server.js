require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Fix for "Invalid path" error: Trim and clean the URL
const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim().replace(/\/$/, "") : null;
const supabaseKey = process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.trim() : null;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ CRITICAL ERROR: SUPABASE_URL or SUPABASE_KEY is missing in environment variables!");
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health Check
app.get('/', (req, res) => {
    res.send('<h1>Quiz App Supabase Backend is Live!</h1>');
});

// Signup
app.post('/auth/signup', async (req, res) => {
    console.log('Signup Attempt:', req.body.email);
    try {
        const { email, password, name, role, deviceId } = req.body;
        const id = uuidv4();

        const { data, error } = await supabase
            .from('users')
            .insert([{ id, email, password, name, role, device_id: deviceId }])
            .select()
            .single();

        if (error) {
            console.error('Supabase Error:', error.message);
            if (error.code === '23505') return res.status(409).json({ message: "User exists" });
            return res.status(500).json({ error: `Database Error: ${error.message}` });
        }
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: `Server Crash: ${e.message}` });
    }
});

// Login
app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .eq('password', password)
            .single();

        if (error || !data) return res.status(401).json({ message: "Invalid credentials" });
        res.json(data);
    } catch (e) { res.status(500).send(e.message); }
});

// Other routes remain same as before
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));




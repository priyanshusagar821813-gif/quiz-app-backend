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

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health Check
app.get('/', (req, res) => {
    res.send('<h1>Quiz App Backend (Supabase) is Live!</h1>');
});

// --- AUTH ---

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
            console.error('Supabase Signup Error:', error.message);
            if (error.code === '23505') return res.status(409).json({ message: "User exists" });
            throw error;
        }
        res.json(data);
    } catch (e) {
        console.error('Signup Crash:', e.message);
        res.status(500).json({ error: e.message });
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

// Delete Account
app.delete('/auth/account', async (req, res) => {
    try {
        const uid = req.query.uid;
        await supabase.from('users').delete().eq('id', uid);
        await supabase.from('groups').delete().eq('teacher_id', uid);
        await supabase.from('attempts').delete().or(`teacher_id.eq.${uid},student_id.eq.${uid}`);
        await supabase.from('allowed_students').delete().eq('teacher_id', uid);
        res.status(204).send();
    } catch (e) { res.status(500).send(e.message); }
});

// --- GROUPS ---

app.get('/groups', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('groups')
            .select('*')
            .eq('teacher_id', req.query.teacherId);

        const mapped = data.map(g => ({
            id: g.id,
            name: g.name,
            teacherId: g.teacher_id,
            subjectCode: g.subject_code,
            passKey: g.pass_key,
            timeLimit: g.time_limit
        }));
        res.json(mapped);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/groups', async (req, res) => {
    try {
        const g = req.body;
        const id = g.id && g.id.length > 5 ? g.id : uuidv4();
        const payload = {
            id,
            name: g.name,
            teacher_id: g.teacherId,
            subject_code: g.subjectCode,
            pass_key: g.passKey,
            time_limit: g.timeLimit
        };

        const { data, error } = await supabase
            .from('groups')
            .upsert([payload])
            .select()
            .single();

        if (error) throw error;
        res.json({ ...data, teacherId: data.teacher_id, subjectCode: data.subject_code, passKey: data.pass_key, timeLimit: data.time_limit });
    } catch (e) { res.status(500).send(e.message); }
});

app.delete('/groups/:id', async (req, res) => {
    try {
        const gid = req.params.id;
        await supabase.from('groups').delete().eq('id', gid);
        await supabase.from('questions').delete().eq('group_id', gid);
        await supabase.from('attempts').delete().eq('group_id', gid);
        res.status(204).send();
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/groups/search', async (req, res) => {
    try {
        const { subjectCode, passKey } = req.query;
        const { data: group } = await supabase
            .from('groups')
            .select('*')
            .ilike('subject_code', subjectCode.trim())
            .ilike('pass_key', passKey.trim())
            .single();

        if (!group) return res.status(404).json({ message: 'Invalid Code' });

        res.json({
            id: group.id,
            name: group.name,
            teacherId: group.teacher_id,
            subjectCode: group.subject_code,
            passKey: group.pass_key,
            timeLimit: group.time_limit
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- QUESTIONS ---

app.get('/questions', async (req, res) => {
    try {
        const { data } = await supabase
            .from('questions')
            .select('*')
            .eq('group_id', req.query.groupId);

        const mapped = data.map(q => ({
            id: q.id,
            text: q.text,
            optionA: q.option_a,
            optionB: q.option_b,
            optionC: q.option_c,
            optionD: q.option_d,
            correctOption: q.correct_option,
            groupId: q.group_id
        }));
        res.json(mapped);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/questions', async (req, res) => {
    try {
        const q = req.body;
        const payload = {
            id: uuidv4(),
            text: q.text,
            option_a: q.optionA,
            option_b: q.optionB,
            option_c: q.optionC,
            option_d: q.optionD,
            correct_option: q.correctOption,
            group_id: q.groupId
        };
        const { data } = await supabase.from('questions').insert([payload]).select().single();
        res.json(data);
    } catch (e) { res.status(500).send(e.message); }
});

app.delete('/questions/:id', async (req, res) => {
    try {
        await supabase.from('questions').delete().eq('id', req.params.id);
        res.status(204).send();
    } catch (e) { res.status(500).send(e.message); }
});

// --- ATTEMPTS ---

app.get('/attempts', async (req, res) => {
    try {
        const { teacherId, studentId } = req.query;
        let query = supabase.from('attempts').select('*');
        if (teacherId) query = query.eq('teacher_id', teacherId);
        if (studentId) query = query.eq('student_id', studentId);

        const { data } = await query.order('timestamp', { ascending: false });

        const mapped = data.map(a => ({
            id: a.id,
            studentId: a.student_id,
            studentName: a.student_name,
            teacherId: a.teacher_id,
            groupId: a.group_id,
            subjectName: a.subject_name,
            score: a.score,
            totalQuestions: a.total_questions,
            videoPath: a.video_path,
            timestamp: a.timestamp
        }));
        res.json(mapped);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/attempts', async (req, res) => {
    try {
        const a = req.body;
        const payload = {
            id: uuidv4(),
            student_id: a.studentId,
            student_name: a.studentName,
            teacher_id: a.teacherId,
            group_id: a.groupId,
            subject_name: a.subjectName,
            score: a.score,
            total_questions: a.totalQuestions,
            video_path: a.videoPath,
            timestamp: Date.now()
        };
        await supabase.from('attempts').insert([payload]);
        res.json({ message: "Saved" });
    } catch (e) { res.status(500).send(e.message); }
});

app.delete('/attempts/:id', async (req, res) => {
    try {
        await supabase.from('attempts').delete().eq('id', req.params.id);
        res.status(204).send();
    } catch (e) { res.status(500).send(e.message); }
});

// --- VIDEO UPLOAD ---
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => cb(null, `proct_${Date.now()}.mp4`)
});
const upload = multer({ storage });
app.post('/proctoring/upload', upload.single('video'), (req, res) => {
    const host = req.get('host');
    const protocol = host.includes('onrender.com') ? 'https' : 'http';
    res.json({ url: `${protocol}://${host}/uploads/${req.file.filename}` });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));


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
const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim().replace(/\/$/, "") : null;
const supabaseKey = process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.trim() : null;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => res.send('<h1>Quiz Master Supabase Backend is Live!</h1>'));

// --- 🚩 MASTER RESET ---
app.get('/dev/factory-reset', async (req, res) => {
    try {
        await supabase.from('attempts').delete().neq('id', '0');
        await supabase.from('questions').delete().neq('id', '0');
        await supabase.from('cheat_alerts').delete().neq('id', '0');
        await supabase.from('allowed_students').delete().neq('id', '0');
        await supabase.from('groups').delete().neq('id', '0');
        await supabase.from('users').delete().neq('id', '0');
        res.json({ message: "Database Cleaned Successfully" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 👤 AUTH ---
app.post('/auth/signup', async (req, res) => {
    try {
        const { email, password, name, role, deviceId } = req.body;
        const { data, error } = await supabase.from('users').insert([{ id: uuidv4(), email, password, name, role, device_id: deviceId }]).select().single();
        if (error) return res.status(error.code === '23505' ? 409 : 500).json({ message: error.message });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.from('users').select('*').eq('email', email).eq('password', password).single();
        if (error || !data) return res.status(401).send();
        res.json(data);
    } catch (e) { res.status(500).send(e.message); }
});

// --- 📁 GROUPS ---
app.get('/groups', async (req, res) => {
    try {
        const { data } = await supabase.from('groups').select('*').eq('teacher_id', req.query.teacherId);
        res.json((data || []).map(g => ({ id: g.id, name: g.name, teacherId: g.teacher_id, subjectCode: g.subject_code, passKey: g.pass_key, timeLimit: g.time_limit })));
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/groups', async (req, res) => {
    try {
        const g = req.body;
        const id = g.id && g.id.length > 5 ? g.id : uuidv4();
        const payload = { id, name: g.name, teacher_id: g.teacherId, subject_code: g.subjectCode, pass_key: g.passKey, time_limit: g.timeLimit };
        const { data, error } = await supabase.from('groups').upsert([payload]).select().single();
        if (error) throw error;
        res.json({ ...data, teacherId: data.teacher_id, subjectCode: data.subject_code, passKey: data.pass_key, timeLimit: data.time_limit });
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/groups/search', async (req, res) => {
    try {
        const { subjectCode, passKey, studentName } = req.query;
        const { data: group } = await supabase.from('groups').select('*').ilike('subject_code', subjectCode.trim()).ilike('pass_key', passKey.trim()).single();
        if (!group) return res.status(404).json({ message: 'Invalid Code' });

        // Security check for allowed student
        const { count } = await supabase.from('allowed_students').select('*', { count: 'exact', head: true }).eq('group_id', group.id);
        if (count > 0) {
            const { data: isAllowed } = await supabase.from('allowed_students').select('*').eq('group_id', group.id).ilike('student_name', studentName.trim()).single();
            if (!isAllowed) return res.status(403).json({ message: 'Not authorized by teacher' });
        }

        res.json({ id: group.id, name: group.name, teacherId: group.teacher_id, subjectCode: group.subject_code, passKey: group.pass_key, timeLimit: group.time_limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 📋 ALLOWED STUDENTS (Teacher Management) ---
app.get('/groups/:groupId/students', async (req, res) => {
    try {
        const { data } = await supabase.from('allowed_students').select('*').eq('group_id', req.params.groupId);
        res.json((data || []).map(s => ({ id: s.id, groupId: s.group_id, teacherId: s.teacher_id, studentName: s.student_name })));
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/groups/:groupId/students', async (req, res) => {
    try {
        const payload = { id: uuidv4(), group_id: req.params.groupId, teacher_id: req.body.teacherId, student_name: req.body.studentName };
        const { data, error } = await supabase.from('allowed_students').insert([payload]).select().single();
        if (error) throw error;
        res.json({ id: data.id, groupId: data.group_id, teacherId: data.teacher_id, studentName: data.student_name });
    } catch (e) { res.status(500).send(e.message); }
});

app.delete('/groups/:groupId/students/:studentId', async (req, res) => {
    try {
        await supabase.from('allowed_students').delete().eq('id', req.params.studentId);
        res.status(204).send();
    } catch (e) { res.status(500).send(e.message); }
});

// --- ❓ QUESTIONS ---
app.get('/questions', async (req, res) => {
    try {
        const { data } = await supabase.from('questions').select('*').eq('group_id', req.query.groupId);
        res.json((data || []).map(q => ({ id: q.id, text: q.text, optionA: q.option_a, optionB: q.option_b, optionC: q.option_c, optionD: q.option_d, correctOption: q.correct_option, groupId: q.group_id })));
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/questions', async (req, res) => {
    try {
        const q = req.body;
        const payload = { id: uuidv4(), text: q.text, option_a: q.optionA, option_b: q.optionB, option_c: q.optionC, option_d: q.optionD, correct_option: q.correctOption, group_id: q.groupId };
        const { data, error } = await supabase.from('questions').insert([payload]).select().single();
        if (error) throw error;
        res.json(data);
    } catch (e) { res.status(500).send(e.message); }
});

app.delete('/questions/:id', async (req, res) => {
    try {
        await supabase.from('questions').delete().eq('id', req.params.id);
        res.status(204).send();
    } catch (e) { res.status(500).send(e.message); }
});

// --- 📝 ATTEMPTS ---
app.get('/attempts', async (req, res) => {
    try {
        const { teacherId, studentId } = req.query;
        let query = supabase.from('attempts').select('*');
        if (teacherId) query = query.eq('teacher_id', teacherId);
        if (studentId) query = query.eq('student_id', studentId);
        const { data } = await query.order('timestamp', { ascending: false });
        res.json((data || []).map(a => ({ id: a.id, studentId: a.student_id, studentName: a.student_name, teacherId: a.teacher_id, groupId: a.group_id, subjectName: a.subject_name, score: a.score, totalQuestions: a.total_questions, videoPath: a.video_path, timestamp: a.timestamp })));
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/attempts', async (req, res) => {
    try {
        const a = req.body;
        await supabase.from('attempts').insert([{ id: uuidv4(), student_id: a.studentId, student_name: a.studentName, teacher_id: a.teacherId, group_id: a.groupId, subject_name: a.subjectName, score: a.score, total_questions: a.totalQuestions, video_path: a.videoPath, timestamp: Date.now() }]);
        // Auto-remove student from passkey list after submission
        await supabase.from('allowed_students').delete().eq('group_id', a.groupId).ilike('student_name', a.studentName.trim());
        res.json({ message: "Saved" });
    } catch (e) { res.status(500).send(e.message); }
});

// --- 🚨 CHEAT ALERTS ---
app.post('/proctoring/cheat-alert', async (req, res) => {
    try {
        const alert = req.body;
        await supabase.from('cheat_alerts').insert([{ id: uuidv4(), student_id: alert.studentId, student_name: alert.studentName, teacher_id: alert.teacherId, subject_name: alert.subjectName, reason: alert.reason, snapshot_base64: alert.snapshotBase64, timestamp: Date.now() }]);
        res.status(200).send("Alert logged");
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/proctoring/cheat-alerts', async (req, res) => {
    try {
        const { teacherId } = req.query;
        const { data } = await supabase.from('cheat_alerts').select('*').eq('teacher_id', teacherId).order('timestamp', { ascending: false });
        res.json((data || []).map(a => ({ id: a.id, studentId: a.student_id, studentName: a.student_name, teacherId: a.teacher_id, subjectName: a.subject_name, reason: a.reason, snapshotBase64: a.snapshot_base64, timestamp: a.timestamp })));
    } catch (e) { res.json([]); }
});

// --- 🎥 VIDEO UPLOAD ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `v_${Date.now()}.mp4`)
});
const upload = multer({ storage });
app.post('/proctoring/upload', upload.single('video'), (req, res) => {
    const host = req.get('host');
    const protocol = host.includes('onrender.com') ? 'https' : 'http';
    res.json({ url: `${protocol}://${host}/uploads/${req.file.filename}` });
});

// 15-Day Auto Cleanup
setInterval(async () => {
    const cutoff = Date.now() - (15 * 24 * 60 * 60 * 1000);
    const { data } = await supabase.from('attempts').select('id, video_path').lt('timestamp', cutoff);
    if (data) {
        for (let a of data) {
            if (a.video_path) {
                const fp = path.join(__dirname, 'uploads', path.basename(a.video_path));
                if (fs.existsSync(fp)) fs.unlinkSync(fp);
            }
            await supabase.from('attempts').delete().eq('id', a.id);
        }
    }
}, 24 * 60 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => console.log(`Server Ready on ${PORT}`));








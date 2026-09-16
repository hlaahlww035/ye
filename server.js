const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type'] }));
app.use(bodyParser.json());
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'netwatch_db.json');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ devices: {}, logs: [] }));
}

function readDB() {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (!data.logs) data.logs = [];
        if (!data.devices) data.devices = {};
        return data;
    } catch (e) {
        return { devices: {}, logs: [] };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// API الاتصال الحقيقي بالميكروتيك
app.post('/api/netwatch', async (req, res) => {
    const { host, port, user, password } = req.body;

    // تحويل المنفذ الممرر من القائمة أو استخدام 8728 الافتراضي
    const targetPort = port ? parseInt(port, 10) : 8728;

    const conn = new RouterOSAPI({
        host: host || "192.168.88.1",
        user: user || "admin",
        password: password || "",
        port: targetPort,
        timeout: 10
    });

    try {
        await conn.connect();
        // جلب قائمة Netwatch الحقيقية من الميكروتيك
        const mikrotikDevices = await conn.write('/tool/netwatch/print');
        await conn.close();

        let db = readDB();
        const result = [];
        const now = new Date().toLocaleString('ar-EG');

        mikrotikDevices.forEach(dev => {
            const ip = dev.host;
            const currentStatus = dev.status; // 'up' أو 'down'
            const comment = dev.comment || 'بدون اسم';

            if (!db.devices[ip]) {
                db.devices[ip] = {
                    host: ip,
                    comment: comment,
                    upCount: currentStatus === 'up' ? 1 : 0,
                    downCount: currentStatus === 'down' ? 1 : 0,
                    lastStatus: currentStatus,
                    since: now
                };
                
                db.logs.unshift({
                    id: Date.now() + Math.random(),
                    host: ip,
                    name: comment,
                    type: currentStatus,
                    message: `تم إضافة الجهاز للنظام بحالة (${currentStatus.toUpperCase()})`,
                    timestamp: now
                });
            } else {
                if (db.devices[ip].lastStatus !== currentStatus) {
                    if (currentStatus === 'up') db.devices[ip].upCount += 1;
                    if (currentStatus === 'down') db.devices[ip].downCount += 1;
                    
                    db.devices[ip].lastStatus = currentStatus;
                    db.devices[ip].since = now;

                    db.logs.unshift({
                        id: Date.now() + Math.random(),
                        host: ip,
                        name: comment,
                        type: currentStatus,
                        message: `تغيرت حالة الجهاز إلى (${currentStatus === 'up' ? 'يعمل UP' : 'متوقف DOWN'})`,
                        timestamp: now
                    });
                }
                db.devices[ip].comment = comment;
            }

            result.push(db.devices[ip]);
        });

        if (db.logs.length > 500) db.logs = db.logs.slice(0, 500);

        saveDB(db);
        res.json({ devices: result, logs: db.logs });

    } catch (err) {
        console.error("خطأ في الاتصال بالميكروتيك:", err.message);
        res.status(500).json({ error: "فشل الاتصال بالميكروتيك: " + err.message });
    }
});

app.get('/api/logs', (req, res) => {
    const db = readDB();
    res.json(db.logs);
});

// توجيه كافة الطلبات الأخرى لفتح الواجهة الرئيسية (تم تعديل المسار لتفادي خطأ PathError)
app.get('(.*)', (req, res) => {
    res.sendFile(path.join(__dirname, 'index_2.html'));
});

// تشغيل السيرفر على البورت المعين محلياً أو من بيئة الاستضافة السحابية
app.listen(PORT, '0.0.0.0', () => {
    console.log("==================================================");
    console.log(` Netwatch Server is running on port: ${PORT}`);
    console.log("==================================================");
});

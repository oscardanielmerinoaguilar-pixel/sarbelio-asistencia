/**
 * Servidor Web Integrado de Desarrollo Local (Express Node.js)
 * Instituto Nacional Dr. Sarbelio Navarrete
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

const DEFAULT_STUDENTS = [
  { id: 1, nie: '8492015', nombres: 'Carlos Eduardo', apellidos: 'Alvarado Gomez', anio_bachillerato: 'Primer Año', bachillerato: 'ITSI', seccion_letra: 'A' },
  { id: 2, nie: '9120482', nombres: 'Sofía Beatriz', apellidos: 'Rivas Morales', anio_bachillerato: 'Primer Año', bachillerato: 'General', seccion_letra: 'A' },
  { id: 3, nie: '7483921', nombres: 'Kevin Alexander', apellidos: 'Martinez Martinez', anio_bachillerato: 'Segundo Año', bachillerato: 'Administrativo Contable', seccion_letra: 'B' },
  { id: 4, nie: '6382019', nombres: 'Valeria Nicolle', apellidos: 'Gutierrez Lopez', anio_bachillerato: 'Tercer Año', bachillerato: 'Salud', seccion_letra: 'A' }
];

let serverStudents = [...DEFAULT_STUDENTS];
let liveAttendances = [];

const ASISTENCIAS_FILE = path.join(DATA_DIR, 'asistencias_live.json');
if (fs.existsSync(ASISTENCIAS_FILE)) {
  try {
    liveAttendances = JSON.parse(fs.readFileSync(ASISTENCIAS_FILE, 'utf8'));
  } catch (e) {}
}

function saveAttendances() {
  try {
    fs.writeFileSync(ASISTENCIAS_FILE, JSON.stringify(liveAttendances, null, 2), 'utf8');
  } catch (e) {}
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/system/info') {
    const isCloud = process.env.RENDER || (!req.headers.host.includes('localhost') && !req.headers.host.includes('127.0.0.1') && !req.headers.host.startsWith('192.168.'));
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const localIp = isCloud ? host : getLocalIp();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      status: 'success',
      isCloud: !!isCloud,
      ip: localIp,
      port: PORT,
      url: isCloud ? `${proto}://${host}` : `http://${localIp}:${PORT}`
    }));
  }

  // Sincronización de estudiantes desde cliente
  if (pathname === '/api/sync/students' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed) && parsed.length > 0) {
          serverStudents = parsed;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'success', count: serverStudents.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ status: 'error' }));
      }
    });
    return;
  }

  // Estado del monitor en vivo para proyector de aula
  if (pathname === '/api/qr/estado') {
    const token = parsedUrl.searchParams.get('token') || '';
    const today = new Date().toISOString().split('T')[0];
    const filtered = liveAttendances.filter(a => {
      return a.fecha === today && (!token || a.token === token || (a.token && a.token.includes(token)));
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      status: 'success',
      total_asistencias: filtered.length,
      asistentes: filtered
    }));
  }

  // Marcaje de asistencia por código NIE (con validación institucional)
  if (pathname === '/api/asistencia/marcar-qr' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const token = (parsed.token || '').trim();
        const nie = (parsed.nie || '').trim();

        if (!nie) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ status: 'error', message: 'Por favor ingrese su NIE de estudiante.' }));
        }

        const student = serverStudents.find(s => s.nie === nie);
        if (!student) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ status: 'error', message: `No se encontró ningún estudiante matriculado con el NIE: ${nie}` }));
        }

        const now = new Date();
        const hoy = now.toISOString().split('T')[0];
        const horaStr = now.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const yaMarcado = liveAttendances.find(a => a.nie === nie && a.fecha === hoy && (!token || a.token === token));
        if (yaMarcado) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({
            status: 'warning',
            message: 'Ya registraste tu asistencia para la clase de hoy.',
            estudiante: `${student.nombres} ${student.apellidos}`,
            hora: yaMarcado.hora_marcaje || horaStr
          }));
        }

        const esTardanza = now.getHours() > 8 || (now.getHours() === 8 && now.getMinutes() > 15);
        const estadoAsis = esTardanza ? 'Tardanza' : 'Presente';

        const nuevaAsis = {
          id: liveAttendances.length + 1,
          token: token,
          nie: student.nie,
          estudiante: `${student.nombres} ${student.apellidos}`,
          nombres: student.nombres,
          apellidos: student.apellidos,
          grado: `${student.anio_bachillerato} ${student.bachillerato} "${student.seccion_letra}"`,
          materia: 'Desarrollo de Software Web',
          fecha: hoy,
          hora: horaStr,
          hora_marcaje: horaStr,
          estado: estadoAsis,
          metodo_registro: 'QR_Estudiante'
        };

        liveAttendances.unshift(nuevaAsis);
        saveAttendances();

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({
          status: 'success',
          message: '¡Asistencia registrada con éxito con el Docente!',
          estudiante: nuevaAsis
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/google-sheets/proxy') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const scriptUrl = parsed.script_url;
        const payload = parsed.payload;

        if (!scriptUrl || !payload) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ status: 'error', message: 'Faltan parámetros' }));
        }

        const urlObj = new URL(scriptUrl);
        const https = require('https');
        const postData = JSON.stringify(payload);

        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const clientReq = https.request(options, (clientRes) => {
          let responseData = '';
          clientRes.on('data', (d) => { responseData += d; });
          clientRes.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ status: 'success', remote_status: clientRes.statusCode, data: responseData }));
          });
        });

        clientReq.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ status: 'error', message: e.message }));
        });

        clientReq.write(postData);
        clientReq.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(500);
        res.end('Error interno del servidor');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });
});

const localIp = getLocalIp();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`================================================================`);
  console.log(` INSTITUTO NACIONAL DR. SARBELIO NAVARRETE`);
  console.log(` Sistema de Gestión de Fichas de Estudiantes`);
  console.log(` Local:   http://localhost:${PORT}`);
  console.log(` Wi-Fi:   http://${localIp}:${PORT}`);
  console.log(` URL QR:  http://${localIp}:${PORT}/?action=scan_qr`);
  console.log(`================================================================`);
});


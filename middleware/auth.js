const jwt = require('jsonwebtoken');

exports.protect = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token tidak ada' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token tidak valid' });
  }
};

exports.adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Hanya admin yang boleh mengakses' });
  }
  next();
};

// Tambahkan Middleware baru untuk Staff (User) dan Admin
exports.staffAndAdmin = (req, res, next) => {
  // Staff memiliki hak akses 'user', admin juga diberi izin
  if (req.user.role !== 'admin' && req.user.role !== 'user') {
    return res.status(403).json({ error: 'Akses ditolak. Anda tidak memiliki izin.' });
  }
  next();
};
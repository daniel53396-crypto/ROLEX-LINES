require("dotenv").config();

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 4
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  next();
}

function generateLicenseKey() {
  const part = () =>
    crypto.randomBytes(4).toString("hex").toUpperCase();

  return `VFX-${part()}-${part()}-${part()}-${part()}`;
}

function calculateExpiry(type) {
  const now = new Date();

  if (type === "7d") {
    now.setDate(now.getDate() + 7);
  } else if (type === "30d") {
    now.setDate(now.getDate() + 30);
  } else if (type === "90d") {
    now.setDate(now.getDate() + 90);
  } else if (type === "lifetime") {
    now.setFullYear(now.getFullYear() + 100);
  } else {
    throw new Error("Invalid license type");
  }

  return now.toISOString();
}

/* ---------------- LOGIN ---------------- */

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.admin = true;

    return res.json({
      success: true
    });
  }

  res.status(401).json({
    success: false,
    message: "Invalid username or password"
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get("/api/session", (req, res) => {
  res.json({
    authenticated: !!req.session.admin
  });
});

/* ---------------- LICENSES ---------------- */

app.get("/api/licenses", requireAdmin, (req, res) => {
  const licenses = db
    .prepare("SELECT * FROM licenses ORDER BY id DESC")
    .all();

  res.json({
    success: true,
    licenses
  });
});

app.post("/api/licenses", requireAdmin, (req, res) => {
  try {
    const {
      customer,
      type,
      maxActivations
    } = req.body;

    if (!customer || !type) {
      return res.status(400).json({
        success: false,
        message: "Customer and license type are required"
      });
    }

    const licenseKey = generateLicenseKey();
    const expiresAt = calculateExpiry(type);

    const result = db
      .prepare(`
        INSERT INTO licenses
        (
          license_key,
          customer,
          type,
          expires_at,
          max_activations,
          activations,
          status,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, 0, 'active', ?)
      `)
      .run(
        licenseKey,
        customer,
        type,
        expiresAt,
        Number(maxActivations) || 1,
        new Date().toISOString()
      );

    const license = db
      .prepare("SELECT * FROM licenses WHERE id = ?")
      .get(result.lastInsertRowid);

    res.json({
      success: true,
      license
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/* ---------------- REVOKE ---------------- */

app.post(
  "/api/licenses/:id/revoke",
  requireAdmin,
  (req, res) => {
    db.prepare(`
      UPDATE licenses
      SET status = 'revoked'
      WHERE id = ?
    `).run(req.params.id);

    res.json({
      success: true
    });
  }
);

/* ---------------- DELETE ---------------- */

app.delete(
  "/api/licenses/:id",
  requireAdmin,
  (req, res) => {
    db.prepare(
      "DELETE FROM licenses WHERE id = ?"
    ).run(req.params.id);

    res.json({
      success: true
    });
  }
);

/* ---------------- EXTENSION VERIFY API ---------------- */

app.post("/api/license/verify", (req, res) => {
  const { licenseKey } = req.body;

  if (!licenseKey) {
    return res.status(400).json({
      valid: false,
      message: "License key required"
    });
  }

  const license = db
    .prepare(`
      SELECT *
      FROM licenses
      WHERE license_key = ?
    `)
    .get(licenseKey);

  if (!license) {
    return res.json({
      valid: false,
      message: "License not found"
    });
  }

  if (license.status !== "active") {
    return res.json({
      valid: false,
      message: "License revoked"
    });
  }

  const now = new Date();
  const expiry = new Date(license.expires_at);

  if (now > expiry) {
    db.prepare(`
      UPDATE licenses
      SET status = 'expired'
      WHERE id = ?
    `).run(license.id);

    return res.json({
      valid: false,
      message: "License expired"
    });
  }

  if (license.activations >= license.max_activations) {
    return res.json({
      valid: false,
      message: "Activation limit reached"
    });
  }

  res.json({
    valid: true,
    customer: license.customer,
    type: license.type,
    expiresAt: license.expires_at,
    activations: license.activations,
    maxActivations: license.max_activations
  });
});

/* ---------------- ACTIVATE ---------------- */

app.post("/api/license/activate", (req, res) => {
  const { licenseKey } = req.body;

  const license = db
    .prepare(`
      SELECT *
      FROM licenses
      WHERE license_key = ?
    `)
    .get(licenseKey);

  if (!license) {
    return res.status(404).json({
      success: false,
      message: "License not found"
    });
  }

  if (license.status !== "active") {
    return res.status(403).json({
      success: false,
      message: "License inactive"
    });
  }

  if (license.activations >= license.max_activations) {
    return res.status(403).json({
      success: false,
      message: "Activation limit reached"
    });
  }

  db.prepare(`
    UPDATE licenses
    SET activations = activations + 1
    WHERE id = ?
  `).run(license.id);

  res.json({
    success: true,
    message: "License activated"
  });
});

/* ---------------- STATS ---------------- */

app.get("/api/stats", requireAdmin, (req, res) => {
  const total = db
    .prepare("SELECT COUNT(*) AS count FROM licenses")
    .get().count;

  const active = db
    .prepare(
      "SELECT COUNT(*) AS count FROM licenses WHERE status = 'active'"
    )
    .get().count;

  const expired = db
    .prepare(
      "SELECT COUNT(*) AS count FROM licenses WHERE status = 'expired'"
    )
    .get().count;

  const revoked = db
    .prepare(
      "SELECT COUNT(*) AS count FROM licenses WHERE status = 'revoked'"
    )
    .get().count;

  res.json({
    total,
    active,
    expired,
    revoked
  });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "login.html")
  );
});

app.listen(PORT, () => {
  console.log(`License panel running on port ${PORT}`);
});
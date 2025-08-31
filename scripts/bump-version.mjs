import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve project root relative to this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = resolve(__dirname, '..', 'package.json');

const raw = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);

// Treat version as an integer-like string; default to 0 if missing/invalid
const current = Number.parseInt(pkg.version, 10);
const next = Number.isFinite(current) ? current + 1 : 1;

pkg.version = String(next);

// Preserve indentation of 2 spaces and trailing newline
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log(`Version bumped: ${current} -> ${pkg.version}`);


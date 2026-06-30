/*
==========================================================
 BUZZNA D74 - PROJECT INTELLIGENCE ENGINE
 Scans repository and generates:
 - PROJECT_STRUCTURE.md
 - PROJECT_PROGRESS.md
 - PROJECT_STATUS.md
==========================================================
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const IGNORE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".github"
];

let stats = {
  totalFiles: 0,
  totalFolders: 0,
  emptyFiles: 0,
  errorFiles: 0,
  okFiles: 0
};

let structureOutput = [];
let errors = [];

/* -----------------------------
   CHECK FILE STATUS
------------------------------*/
function checkFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");

    if (!content || content.trim().length === 0) {
      stats.emptyFiles++;
      return "🔴 Empty";
    }

    stats.okFiles++;
    return "✅";
  } catch (err) {
    stats.errorFiles++;
    errors.push(filePath);
    return "⚠ Error";
  }
}

/* -----------------------------
   SCAN DIRECTORY RECURSIVELY
------------------------------*/
function scanDir(dir, indent = "") {
  const items = fs.readdirSync(dir);

  stats.totalFolders++;

  items.forEach(item => {
    const fullPath = path.join(dir, item);

    if (IGNORE_DIRS.includes(item)) return;

    const isDir = fs.lstatSync(fullPath).isDirectory();

    if (isDir) {
      structureOutput.push(`${indent}${item}/`);
      scanDir(fullPath, indent + "  ");
    } else {
      stats.totalFiles++;
      const status = checkFile(fullPath);

      structureOutput.push(`${indent}${item} ${status}`);
    }
  });
}

/* -----------------------------
   GENERATE STRUCTURE FILE
------------------------------*/
function generateStructure() {
  const output = `
# PROJECT STRUCTURE

\`\`\`
${structureOutput.join("\n")}
\`\`\`
`;

 const existing = fs.existsSync("PROJECT_STRUCTURE.md")
  ? fs.readFileSync("PROJECT_STRUCTURE.md", "utf8")
  : "";

if (existing !== structureOutput.join("\n")) {
  fs.writeFileSync("PROJECT_STRUCTURE.md", output);
}
}

/* -----------------------------
   GENERATE PROGRESS FILE
------------------------------*/
function generateProgress() {
  const progress = `
# PROJECT PROGRESS

| Metric | Value |
|--------|------:|
| Total Files | ${stats.totalFiles} |
| Total Folders | ${stats.totalFolders} |
| OK Files | ${stats.okFiles} |
| Empty Files | ${stats.emptyFiles} |
| Error Files | ${stats.errorFiles} |
`;

 const existing = fs.existsSync("PROJECT_PROGRESS.md")
  ? fs.readFileSync("PROJECT_PROGRESS.md", "utf8")
  : "";

if (existing !== progress
) {
  fs.writeFileSync("PROJECT_PROGRESS.md", progress);
}
}

/* -----------------------------
   GENERATE STATUS FILE
------------------------------*/
function generateStatus() {
  const health = Math.round(
    (stats.okFiles / (stats.totalFiles || 1)) * 100
  );

  const status = `
# PROJECT STATUS

Repository Health: ${health}%

Folders: ${stats.totalFolders}
Files: ${stats.totalFiles}

Implemented: ${stats.okFiles}
Empty: ${stats.emptyFiles}
Errors: ${stats.errorFiles}

Last Scan:
${new Date().toISOString()}
`;

 const existing = fs.existsSync("PROJECT_STATUS.md")
  ? fs.readFileSync("PROJECT_STATUS.md", "utf8")
  : "";

if (existing !== status) {
  fs.writeFileSync("PROJECT_STATUS.md", status);
}

}

/* -----------------------------
   RUN ENGINE
------------------------------*/
function run() {
  console.log("Scanning repository...");

  scanDir(ROOT);

  generateStructure();
  generateProgress();
  generateStatus();

  console.log("Done.");
  console.log("Errors:", errors);
}

run();

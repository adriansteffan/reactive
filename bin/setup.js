#!/usr/bin/env node

import { mkdirSync, readdirSync, copyFileSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});


const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.name === 'package.json') {
      // Skip package.json as we'll handle it separately
      continue;
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  try {
    
    const projectName = await question('Please enter your project name: ');

    if (!projectName.trim()) {
      console.error('Project name cannot be empty');
      process.exit(1);
    }

    const projectPath = join(process.cwd(), projectName);
    mkdirSync(projectPath, { recursive: true });

    const templatePath = join(__dirname, '../template');

    if (!existsSync(templatePath)) {
      console.error('Template directory not found');
      process.exit(1);
    }

    copyDir(templatePath, projectPath);

    const templatePackageJsonPath = join(templatePath, 'package.json');
    if (!existsSync(templatePackageJsonPath)) {
      console.error('Template package.json not found');
      process.exit(1);
    }

    let packageJsonContent = readFileSync(templatePackageJsonPath, 'utf8');
    packageJsonContent = packageJsonContent.replace(/PROJECT_NAME/g, projectName);

    writeFileSync(join(projectPath, 'package.json'), packageJsonContent);

    console.log(`
Project ${projectName} created successfully!

To get started:
    cd ${projectName}
    npm i
    npm run dev
    `);

  } catch (error) {
    console.error('Error creating project:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the main function
main();
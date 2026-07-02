import mammoth from 'mammoth'
import { read, utils } from 'xlsx'
import fs from 'node:fs'

const docx = 'data/BUZZNA_D74_Comprehensive_System_Analysis-0dd8a8.docx'
const xlsx = 'data/fragrant-poetry-27919622_production_neondb_2026-06-29_19-13-41-da7a75.xlsx'

const { value } = await mammoth.extractRawText({ path: docx })
fs.writeFileSync('data/_docx_full.txt', value)
console.log('DOCX written to data/_docx_full.txt, length', value.length)

const wb = read(fs.readFileSync(xlsx), { cellDates: true })
for (const name of wb.SheetNames) {
  const rows = utils.sheet_to_json(wb.Sheets[name], { header: 1 })
  console.log('\n=== SHEET:', name, 'rows:', rows.length, '===')
  console.log('HEADERS:', JSON.stringify(rows[0]))
  console.log('SAMPLE ROW 1:', JSON.stringify(rows[1]))
  console.log('SAMPLE ROW 2:', JSON.stringify(rows[2]))
}

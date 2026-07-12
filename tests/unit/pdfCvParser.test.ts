import { describe, expect, it } from 'vitest'
import { parseCvText } from '../../apps/extension/src/features/import/pdfCvParser'

describe('parseCvText', () => {
  it('extracts common contact data and CV sections without inventing data', () => {
    const result = parseCvText(`
Jane Doe
Dubai, United Arab Emirates
jane.doe@example.com | +971 50 123 4567
https://www.linkedin.com/in/jane-doe

Professional Summary
Software engineer with five years of experience building secure web applications.

Skills
TypeScript, React, Node.js, Python, Docker

Work Experience
Senior Software Engineer — Example Co. | 2023–Present
Built and maintained browser-based workflow tools.

Education
BSc Computer Science — Example University | 2020

Certifications
AWS Certified Cloud Practitioner
`)

    expect(result.profileName).toBe('Jane Doe')
    expect(result.values).toMatchObject({
      name: 'Jane Doe',
      'e-mail': 'jane.doe@example.com',
      phone: '+971 50 123 4567',
      location: 'Dubai, United Arab Emirates'
    })

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Professional Summary' }),
      expect.objectContaining({ title: 'Skills' }),
      expect.objectContaining({ title: 'Work Experience' }),
      expect.objectContaining({ title: 'Education' }),
      expect.objectContaining({ title: 'Certifications' }),
      expect.objectContaining({ title: 'LinkedIn profile', sensitivity: 'public' })
    ]))
  })

  it('recognizes richer CV headings, inline heading content, and public profile links', () => {
    const result = parseCvText(`
Full Name: Sara Khan
Data Analyst and Automation Specialist
Location: Sharjah, United Arab Emirates
Email: sara.khan@example.com
Mobile: +971 55 987 6543
LinkedIn: https://linkedin.com/in/sara-khan
GitHub: https://github.com/sarakhan
Portfolio: https://sarakhan.dev

Overview: Data analyst focused on automation, reporting, and operational dashboards.

Technical Skills: Python, SQL, Power BI, Excel, TypeScript

CAREER HISTORY
Data Analyst - Rapid Example LLC | 2022 - Present
Created automated reporting dashboards and reduced manual reporting work.

ACADEMIC QUALIFICATIONS
BSc Information Systems - Example University | 2021

Certifications and Training
Microsoft Power BI Data Analyst

Awards and Achievements
Won internal automation challenge in 2024.

Language Proficiency
English - Fluent
Arabic - Intermediate
`)

    expect(result.profileName).toBe('Sara Khan')
    expect(result.values).toMatchObject({
      name: 'Sara Khan',
      'professional-title': 'Data Analyst and Automation Specialist',
      'e-mail': 'sara.khan@example.com',
      phone: '+971 55 987 6543',
      location: 'Sharjah, United Arab Emirates'
    })

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'LinkedIn profile', sensitivity: 'public' }),
      expect.objectContaining({ title: 'GitHub profile', sensitivity: 'public' }),
      expect.objectContaining({ title: 'Website / portfolio', sensitivity: 'public' }),
      expect.objectContaining({ title: 'Professional Summary', content: expect.stringContaining('Data analyst focused on automation') }),
      expect.objectContaining({ title: 'Skills', content: expect.stringContaining('Python, SQL') }),
      expect.objectContaining({ title: 'Work Experience', content: expect.stringContaining('Rapid Example LLC') }),
      expect.objectContaining({ title: 'Education', content: expect.stringContaining('BSc Information Systems') }),
      expect.objectContaining({ title: 'Certifications' }),
      expect.objectContaining({ title: 'Achievements' }),
      expect.objectContaining({ title: 'Languages' })
    ]))
  })

  it('returns warnings when reliable contact data cannot be found', () => {
    const result = parseCvText(`
Curriculum Vitae

Projects
A local research project about document parsing.
`)

    expect(result.warnings).toContain('A full name was not recognized. Add or correct it before saving.')
    expect(result.warnings).toContain('No email address or phone number was recognized.')
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Projects' })
    ]))
  })
})

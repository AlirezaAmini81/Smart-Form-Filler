import { describe, expect, it } from 'vitest'
import {
  ParsedCvDataSchema,
  parseCvText
} from '../../apps/extension/src/features/import/pdfCvParser'
import { parsedCvToCandidates } from '../../apps/extension/src/features/settings/documentImportService'

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

  it('extracts separately labeled personal, contact, and address fields from middle-dot bullets', () => {
    const result = parseCvText(`
Alex Morgan
Personal Information
· Full name: Alex Morgan
· First name: Alex
· Last name: Morgan
· Date of birth: 15 March 1992
· Age: 34
· Gender: Male
· Salutation: Mr.
· Nationality: German
· Marital status: Single
Contact Information
· E-mail: alex.morgan@example.com
· Phone: +49 30 5550 1234
· Mobile phone: +49 151 5550 5678
· Website: https://alex-morgan.example.com
· LinkedIn: https://www.linkedin.com/in/alex-morgan-example
· GitHub: https://github.com/alex-morgan-example
Address
· Street: Musterstraße 42
· Postal code: 10115
· City: Berlin
· State: Berlin
· Country: Germany
· Full address: Musterstraße 42, 10115 Berlin, Germany
`)

    expect(result.values).toEqual({
      name: 'Alex Morgan',
      'first-name': 'Alex',
      'last-name': 'Morgan',
      'date-of-birth': '15 March 1992',
      age: '34',
      gender: 'Male',
      salutation: 'Mr.',
      nationality: 'German',
      'marital-status': 'Single',
      'e-mail': 'alex.morgan@example.com',
      phone: '+49 30 5550 1234',
      'mobile-phone': '+49 151 5550 5678',
      'street-address': 'Musterstraße 42',
      'postal-code': '10115',
      city: 'Berlin',
      state: 'Berlin',
      country: 'Germany',
      'full-address': 'Musterstraße 42, 10115 Berlin, Germany'
    })
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Website / portfolio', content: 'https://alex-morgan.example.com' }),
      expect.objectContaining({ title: 'LinkedIn profile', content: 'https://www.linkedin.com/in/alex-morgan-example' }),
      expect.objectContaining({ title: 'GitHub profile', content: 'https://github.com/alex-morgan-example' })
    ]))
    expect(parsedCvToCandidates(result).map((candidate) => candidate.label)).toEqual(expect.arrayContaining([
      'Salutation',
      'Mobile phone',
      'Street address',
      'Postal code',
      'City',
      'State',
      'Country',
      'Full address'
    ]))
  })

  it('converts employment, qualifications, preferences, and standard answers into reviewable fields', () => {
    const result = parseCvText(`
Alex Morgan
Professional Summary
Product-focused software engineer with eight years of experience building accessible web applications.
Current Employment
· Professional title: Senior Software Engineer
· Employer: Example Technologies GmbH
· Department: Product Engineering
· Employment type: Full-time
· Start date: April 2021
· Current location: Berlin, Germany
· Notice period: Three months
Work Experience
Senior Software Engineer — Example Technologies GmbH
Berlin, Germany — April 2021 to present
· Developed TypeScript and React applications used by international customers.
Software Engineer — Sample Digital AG
Hamburg, Germany — August 2017 to March 2021
· Built responsive web interfaces and REST APIs.
Education
Master of Science in Computer Science
Technical University of Berlin — 2015 to 2017
· Final grade: 1.6
· Specialization: Human-Computer Interaction
Bachelor of Science in Computer Science
University of Hamburg — 2011 to 2015
· Final grade: 1.9
Skills
· Programming languages: TypeScript, JavaScript, Python, SQL
· Frontend: React, HTML, CSS, Tailwind CSS, accessibility
· Backend: Node.js, Express, REST APIs
· Testing: Vitest, Playwright, unit testing, integration testing
Languages
· German: Native
· English: Fluent (C1)
Certifications
· Professional Scrum Master I — Scrum.org, 2022
Projects
Accessible Application Portal
Designed and implemented an accessible application portal using React, TypeScript, and Node.js.
Application Information
· Preferred role: Senior Software Engineer
· Preferred employment type: Full-time
· Preferred work arrangement: Hybrid or remote
· Preferred location: Berlin or remote within Germany
· Earliest start date: Three months after contract signature
· Salary expectation: EUR 85,000 gross per year
· Willing to relocate: No
· Willing to travel: Up to 20 percent
· Work authorization: Authorized to work in Germany
· Driving license: German category B
Standard Answers
Why are you interested in this role?
I am interested in roles where I can combine hands-on software development with product thinking,
accessibility, and technical mentoring.
What are your strengths?
My strengths are structured problem solving, clear communication, and maintainable implementation.
Availability
I am generally available for interviews on weekday afternoons with at least two business days of notice.
Interests
· Hiking
· Photography
· Accessible technology
This document contains entirely synthetic information for testing purposes.
`)

    expect(result.values['professional-title']).toBe('Senior Software Engineer')
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Professional Summary' }),
      expect.objectContaining({ title: 'Employer', content: 'Example Technologies GmbH' }),
      expect.objectContaining({ title: 'Department', content: 'Product Engineering' }),
      expect.objectContaining({ title: 'Employment type', content: 'Full-time' }),
      expect.objectContaining({ title: 'Current location', content: 'Berlin, Germany', sensitivity: 'sensitive' }),
      expect.objectContaining({ title: 'Work Experience', content: expect.stringContaining('Sample Digital AG') }),
      expect.objectContaining({ title: 'Education', content: expect.stringContaining('Master of Science') }),
      expect.objectContaining({ title: 'Programming languages', content: expect.stringContaining('TypeScript') }),
      expect.objectContaining({ title: 'German', content: 'Native' }),
      expect.objectContaining({ title: 'Certifications' }),
      expect.objectContaining({ title: 'Projects', content: expect.stringContaining('Accessible Application Portal') }),
      expect.objectContaining({ title: 'Preferred role', content: 'Senior Software Engineer' }),
      expect.objectContaining({ title: 'Salary expectation', content: 'EUR 85,000 gross per year', sensitivity: 'sensitive' }),
      expect.objectContaining({ title: 'Why are you interested in this role?', content: expect.stringContaining('product thinking') }),
      expect.objectContaining({ title: 'What are your strengths?', content: expect.stringContaining('structured problem solving') }),
      expect.objectContaining({ title: 'Availability', content: expect.stringContaining('weekday afternoons') }),
      expect.objectContaining({ title: 'Interests', content: expect.stringContaining('Photography') })
    ]))
    expect(result.entries.find((entry) => entry.title === 'Interests')?.content).not.toContain('synthetic information')

    const candidates = parsedCvToCandidates(result)
    expect(candidates.map((candidate) => candidate.label)).toEqual(expect.arrayContaining([
      'Professional title',
      'Employer',
      'Department',
      'Employment type',
      'Start date',
      'Current location',
      'Notice period',
      'Final grade',
      'Specialization',
      'Programming languages',
      'Frontend',
      'Backend',
      'Testing',
      'German',
      'English',
      'Preferred role',
      'Preferred employment type',
      'Preferred work arrangement',
      'Preferred location',
      'Earliest start date',
      'Salary expectation',
      'Willing to relocate',
      'Willing to travel',
      'Work authorization',
      'Driving license',
      'Why are you interested in this role?',
      'What are your strengths?',
      'Availability',
      'Interests'
    ]))

    const gradeCandidates = candidates.filter((candidate) => candidate.label === 'Final grade')
    expect(gradeCandidates).toHaveLength(2)
    expect(gradeCandidates.map((candidate) => candidate.decision)).toEqual(['replace', 'alternative'])
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

  it('rejects empty documents and invalid parsed-profile data', () => {
    expect(() => parseCvText('')).toThrow('No usable profile data was extracted')
    expect(() => ParsedCvDataSchema.parse({
      values: { name: 'Synthetic User' },
      entries: [{ title: 'Skills', content: 'TypeScript', long: false, sensitivity: 'invalid' }],
      warnings: []
    })).toThrow()
  })
})

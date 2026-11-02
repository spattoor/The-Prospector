// Curated paraphrases of official TTU pages reviewed 2026-11-01. No student records.
export const campusFacts = [
  { id: 'registrar-services', text: 'The Registrar provides registration, transcript, enrollment and degree-record services.',
    keywords: ['registration', 'register', 'transcript', 'enrollment', 'degree', 'records'],
    source: 'https://www.depts.ttu.edu/registrar/' },
  { id: 'registrar-contact', text: 'The Registrar is in West Hall, Room 103. Contact registrar@ttu.edu or 806-742-3661.',
    keywords: ['registrar', 'contact', 'transcript', 'where', 'records'], source: 'https://www.depts.ttu.edu/registrar/' },
  { id: 'calendar-source', text: 'TTU’s official academic calendar is maintained by the Office of Official Publications. Follow the academic calendar link on the Registrar website for current dates.',
    keywords: ['calendar', 'semester', 'dates', 'academic'], source: 'https://www.depts.ttu.edu/registrar/' },
  { id: 'aid-application', text: 'TTU directs students seeking federal financial aid to the FAFSA. Its school code is 003644. Aid eligibility must be confirmed with the financial aid office.',
    keywords: ['fafsa', 'aid', 'financial', 'school', 'code'], source: 'https://www.depts.ttu.edu/financialaid/' },
  { id: 'aid-contact', text: 'Financial Aid and Scholarships lists West Hall 301, finaid.advisor@ttu.edu and 806-742-3681 as contact details.',
    keywords: ['aid', 'financial', 'scholarship', 'contact', 'where'], source: 'https://www.depts.ttu.edu/financialaid/' },
];
export function retrieveCampus(question) {
  const words = new Set(question.toLowerCase().match(/[a-z]+/g) || []);
  return campusFacts.map(f => ({ ...f, matches: f.keywords.filter(k => words.has(k)).length }))
    .filter(f => f.matches > 0).sort((a, b) => b.matches - a.matches).slice(0, 3);
}

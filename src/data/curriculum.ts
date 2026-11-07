import type { Lesson, Question } from "../types";

type Entry = { english: string; idoma: string; example?: string };

// These answer pairs are taken from the bundled dictionary categories in
// backend/idoma_dictionary_v3.json. Add new lesson content only after review;
// don't generate language examples from the translation model.

function lessonQuestion(id: string, entry: Entry, distractors: string[]): Question {
  const options = distractors.filter((word) => word !== entry.idoma).slice(0, 3);
  const correctPosition = id.split("").reduce((value, character) => value + character.charCodeAt(0), 0) % (options.length + 1);
  options.splice(correctPosition, 0, entry.idoma);
  return {
    id,
    question: `How do you say “${entry.english}” in Idoma?`,
    options,
    correctAnswer: entry.idoma,
    translation: entry.example || `${entry.idoma} — ${entry.english}`,
  };
}

const greetings: Entry[] = [
  { english: "Good morning", idoma: "Nmaochi" },
  { english: "Good night", idoma: "Nmoo Gb'ochi", example: "Nmoo Gb'ochi (Good Night); also: Ol'bonchi" },
  { english: "Goodbye", idoma: "Nmoo" },
  { english: "Thank you", idoma: "Ófé", example: "Ófé (Thank you)" },
  { english: "Welcome", idoma: "Ainya Owa" },
];
const numbers: Entry[] = [
  { english: "One", idoma: "òyé", example: "Òyé (One)" },
  { english: "Two", idoma: "èpà", example: "Èpà (Two)" },
  { english: "Three", idoma: "ɛ́mā", example: "Ɛ́mā (Three)" },
  { english: "Four", idoma: "ɛ́lɛ̄", example: "Ɛ́lɛ̄ (Four)" },
  { english: "Five", idoma: "ɛ́hɔ̄", example: "Ɛ́hɔ̄ (Five)" },
];
const heritage: Entry[] = [
  { english: "Ancestors", idoma: "Alekwu" },
  { english: "Tradition", idoma: "Ogwuchekwo" },
  { english: "Masquerade", idoma: "Ekwu" },
  { english: "Sacred", idoma: "Iho" },
  { english: "Oracle", idoma: "Obochi" },
];
const phrases: Entry[] = [
  { english: "Please", idoma: "K'ocho", example: "K'ocho (Please)" },
  { english: "Hello", idoma: "Ówúrú", example: "Ówúrú (Hello)" },
  { english: "Yes", idoma: "Éhò", example: "Éhò (Yes)" },
  { english: "No", idoma: "Kú", example: "Kú (No)" },
  { english: "Sit down", idoma: "Chíchẽ àjè", example: "Chíchẽ àjè (Sit down)" },
];

function questions(entries: Entry[]): Question[] {
  return entries.map((entry, index) => lessonQuestion(
    entry.english.toLowerCase().replace(/ /g, "-"),
    entry,
    entries.filter((_, candidate) => candidate !== index).map((other) => other.idoma),
  ));
}

export const curriculumLessons: Lesson[] = [
  { id: "daily-greetings", title: "Daily Greetings", track_id: "track_1_greetings", level: "Beginner", topic: "Greetings", questions: questions(greetings) },
  { id: "numbers-1-5", title: "Numbers One to Five", track_id: "track_2_numbers", level: "Beginner", topic: "Numbers", questions: questions(numbers) },
  { id: "culture-heritage", title: "Culture & Heritage Words", track_id: "track_3_idioms", level: "Intermediate", topic: "Culture", questions: questions(heritage) },
  { id: "everyday-phrases", title: "Everyday Phrases", track_id: "track_4_folktales", level: "Intermediate", topic: "Phrases", questions: questions(phrases) },
];

export function lessonForTrack(trackId: string): Lesson | undefined {
  return curriculumLessons.find((lesson) => lesson.track_id === trackId);
}

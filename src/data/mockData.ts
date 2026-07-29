import type { Lesson } from "../types";

export const anatomyLesson: Lesson = {
  id: "anatomy",
  title: "Human Anatomy (Head)",
  questions: [
    {
      id: "a1",
      question: "What is the Idoma word for 'head'?",
      options: ["éyì", "ikpéyí", "òkò", "àhúnù"],
      correctAnswer: "ikpéyí",
      translation: "ikpéyí — head (noun)",
    },
    {
      id: "a2",
      question: "What does 'éyì' mean in Idoma?",
      options: ["Eye", "Face", "Nose", "Mouth"],
      correctAnswer: "Face",
      translation: "éyì — face",
    },
    {
      id: "a3",
      question: "How do you say 'tongue' in Idoma?",
      options: ["àhúnù", "ìgbènyì", "òkónu", "éhun"],
      correctAnswer: "ìgbènyì",
      translation: "ìgbènyì — tongue",
    },
    {
      id: "a4",
      question: "What is the Idoma word for 'tooth'?",
      options: ["àhúnù", "okpuęyí", "onwueyí", "òkò"],
      correctAnswer: "àhúnù",
      translation: "àhúnù — tooth",
    },
    {
      id: "a5",
      question: "Which Idoma word means 'nose'?",
      options: ["omù", "éhun", "òkónu", "éyì"],
      correctAnswer: "éhun",
      translation: "éhun — nose",
    },
  ],
};

export const anatomyTrunkLesson: Lesson = {
  id: "anatomy-trunk",
  title: "Human Anatomy (Trunk & Limbs)",
  questions: [
    {
      id: "t1",
      question: "What is the Idoma word for 'hand'?",
      options: ["ikpo", "abó", "ìkpó", "àìígàbò"],
      correctAnswer: "abó",
      translation: "abó — hand",
    },
    {
      id: "t2",
      question: "How do you say 'foot' in Idoma?",
      options: ["ikpo", "ìkpó", "òkwúkwù", "àchá"],
      correctAnswer: "ikpo",
      translation: "ikpo — foot",
    },
    {
      id: "t3",
      question: "What does 'òkwúkwù' mean?",
      options: ["Elbow", "Knee", "Hip", "Back"],
      correctAnswer: "Knee",
      translation: "òkwúkwù — knee",
    },
    {
      id: "t4",
      question: "What is the Idoma word for 'bone'?",
      options: ["òkpíye", "ùkpòkpú", "ìpún", "ìgbíhì"],
      correctAnswer: "ùkpòkpú",
      translation: "ùkpòkpú — bone",
    },
  ],
};

export const faunaLesson: Lesson = {
  id: "fauna",
  title: "Fauna & Elements",
  questions: [
    {
      id: "f1",
      question: "What is the Idoma word for 'dog'?",
      options: ["Èwü", "èwo", "Ònyà", "Ügū"],
      correctAnswer: "èwo",
      translation: "èwo — dog",
    },
    {
      id: "f2",
      question: "How do you say 'snake' in Idoma?",
      options: ["Èbínyi", "Égwā", "èwo", "ēchō"],
      correctAnswer: "Égwā",
      translation: "Égwā — snake",
    },
    {
      id: "f3",
      question: "What does 'ēnyi' mean in Idoma?",
      options: ["Fire", "Tree", "Water", "Stone"],
      correctAnswer: "Water",
      translation: "ēnyi — water",
    },
    {
      id: "f4",
      question: "What is the Idoma word for 'fire'?",
      options: ["ōchi", "ēchō", "Olà", "Ügū"],
      correctAnswer: "Olà",
      translation: "Olà — fire",
    },
  ],
};

export const verbLesson: Lesson = {
  id: "verbs",
  title: "Verbs & Actions",
  questions: [
    {
      id: "v1",
      question: "How do you say 'eat' in Idoma?",
      options: ["Gwá", "Lé", "kwó", "yàhù"],
      correctAnswer: "Lé",
      translation: "Lé — to eat",
    },
    {
      id: "v2",
      question: "What does 'Gwá' mean in Idoma?",
      options: ["Eat", "Hear", "Drink", "Walk"],
      correctAnswer: "Drink",
      translation: "Gwá — to drink",
    },
    {
      id: "v3",
      question: "How do you say 'sit' in Idoma?",
      options: ["chíchę", "jáhó", "yàhù", "apo"],
      correctAnswer: "chíchę",
      translation: "chíchę — to sit",
    },
    {
      id: "v4",
      question: "What is the Idoma word for 'listen'?",
      options: ["apo", "kwó", "jáhó", "púnpi"],
      correctAnswer: "jáhó",
      translation: "jáhó — to listen",
    },
  ],
};

export function getAllLessons(): Lesson[] {
  return [anatomyLesson, anatomyTrunkLesson, faunaLesson, verbLesson];
}

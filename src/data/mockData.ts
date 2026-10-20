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

// Social, Media, Books & Learning Tracks Mock Data
export const mockUsers: import("../types").User[] = [
  {
    id: "user_oche",
    username: "oche",
    display_name: "Oche Adole",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    bio: "Native Idoma linguist and custodian of Otukpo ancestral traditions.",
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
  {
    id: "user_ada",
    username: "ada",
    display_name: "Ada Owoicho",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
    bio: "Passionate about digitizing Idoma folklore, music, and oral dialects.",
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
  },
  {
    id: "user_idoko",
    username: "idoko",
    display_name: "Idoko Ejembi",
    avatar_url: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150",
    bio: "Language learner tracking my path to intermediate Idoma speaker status.",
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
];

export const mockCurriculumTracks: import("../types").LearningTrack[] = [
  {
    id: "track_1_greetings",
    step: 1,
    title: "1. Daily Greetings",
    description: "Learn traditional morning, noon, and evening salutations in Idoma.",
    xp_reward: 200,
    category: "Beginner Foundation",
    status: "completed",
  },
  {
    id: "track_2_numbers",
    step: 2,
    title: "2. Numerical Quantifiers",
    description: "Master counting, trade numbers, and cardinal quantities.",
    xp_reward: 250,
    category: "Core Vocabulary",
    status: "completed",
  },
  {
    id: "track_3_idioms",
    step: 3,
    title: "3. Proverbial Idioms",
    description: "Explore classical Idoma proverbs, figurative sayings, and ancestral wisdom.",
    xp_reward: 300,
    category: "Intermediate Fluency",
    status: "active",
  },
  {
    id: "track_4_folktales",
    step: 4,
    title: "4. Cultural Folktales & Ancestry",
    description: "Immerse in ancient narrative lore and oral historical heritage of the Alekwu.",
    xp_reward: 350,
    category: "Advanced Mastery",
    status: "locked",
  },
];

export const mockPosts: import("../types").Post[] = [
  {
    id: "post_1",
    user_id: "user_oche",
    author: mockUsers[0],
    content: "Listen to my native pronunciation of the sacred greeting: *'Aôlô l'ohe o!'* (May your dawn bring peace). In the Otukpo heartland, greeting the dawn affirms communal harmony.",
    media_type: "audio",
    media_url: "https://actions.google.com/sounds/v1/speech/voice_greeting.ogg",
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
  },
  {
    id: "post_2",
    user_id: "user_ada",
    author: mockUsers[1],
    content: "Traditional Idoma textiles: The **Apa** (black and red fabric) symbolizes the resilience and royalty of our forebears. Black stands for ancestral sovereignty; Red represents the vital spirit of life.",
    media_type: "image",
    media_url: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800",
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: "post_3",
    user_id: "user_idoko",
    author: mockUsers[2],
    content: "Just crossed 200 XP on the Daily Greetings module! *'Ékwù n'wà guide our path'*. The audio repetition exercises make tone variations so much clearer.",
    media_type: "text",
    created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
  },
];

export const mockBooks: import("../types").Book[] = [
  {
    id: "book_1",
    title: "Idoma Grammar and Orthography Standard Guide",
    author: "Prof. E. O. Armstrong & Benue Language Committee",
    uploaded_by: "user_oche",
    file_url: "/api/books/sample/idoma_orthography.txt",
    description: "Comprehensive morphological analysis of Central and Western Idoma phonetics, tones, and noun classes.",
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
  {
    id: "book_2",
    title: "Alekwu Oral Poetry & The Songs of Ancestors",
    author: "Elder Ada Agada",
    uploaded_by: "user_ada",
    file_url: "/api/books/sample/alekwu_chants.txt",
    description: "Transcriptions and English annotations of historical funeral and coronation dirges in Otukpo.",
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: "book_3",
    title: "Proverbs and Idiomatic Sayings of Idomaland",
    author: "Idoma Cultural Heritage Foundation",
    uploaded_by: "user_oche",
    file_url: "/api/books/sample/idoma_proverbs.txt",
    description: "Over 300 proverbial phrases with tonal diacritics, literal translations, and contextual meanings.",
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];


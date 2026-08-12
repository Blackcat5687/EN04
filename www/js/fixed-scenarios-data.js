/**
 * fixed-scenarios-data.js — سيناريوهات السياق الثابت (لا تعتمد على كلمات محددة)
 */

const FIXED_SCENARIO_TOPICS = [
  {
    id: 'restaurant',
    label: 'مطعم',
    icon: '🍽️',
    promptContext: 'A conversation between a customer and a waiter at a restaurant: ordering food, asking about the menu, and requesting the bill.',
  },
  {
    id: 'airport',
    label: 'مطار',
    icon: '✈️',
    promptContext: 'A conversation at an airport: checking in, going through security, or asking about a flight gate and boarding time.',
  },
  {
    id: 'school',
    label: 'مدرسة',
    icon: '🏫',
    promptContext: 'A conversation between a student and a teacher or classmate at school: discussing homework, class schedule, or an upcoming exam.',
  },
  {
    id: 'shopping',
    label: 'تسوّق',
    icon: '🛍️',
    promptContext: 'A conversation between a customer and a shop assistant while shopping for clothes: asking about sizes, prices, and trying items on.',
  },
  {
    id: 'doctor',
    label: 'عيادة طبيب',
    icon: '🩺',
    promptContext: 'A conversation between a patient and a doctor or receptionist: describing symptoms and booking an appointment.',
  },
  {
    id: 'hotel',
    label: 'فندق',
    icon: '🏨',
    promptContext: 'A conversation at a hotel reception: checking in, asking about amenities, or requesting a room change.',
  },
  {
    id: 'taxi',
    label: 'تاكسي / مواصلات',
    icon: '🚕',
    promptContext: 'A conversation between a passenger and a taxi driver: giving directions, discussing the fare, and small talk during the ride.',
  },
  {
    id: 'small-talk',
    label: 'حديث عشوائي',
    icon: '💬',
    promptContext: 'A casual, friendly small-talk conversation between two acquaintances about their day, weather, hobbies, or weekend plans.',
  },
  {
    id: 'job-interview',
    label: 'مقابلة عمل',
    icon: '💼',
    promptContext: 'A job interview conversation between a candidate and an interviewer: discussing experience, skills, and expectations.',
  },
  {
    id: 'phone-call',
    label: 'مكالمة هاتفية',
    icon: '📞',
    promptContext: 'A phone call conversation, such as calling to make a reservation, asking about opening hours, or following up on an order.',
  },
];

window.FIXED_SCENARIO_TOPICS = FIXED_SCENARIO_TOPICS;

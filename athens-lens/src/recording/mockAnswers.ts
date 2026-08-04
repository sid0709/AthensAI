export interface MockFormAnswer {
  id: string;
  question: string;
  answer: string;
}

export const MOCK_FORM_ANSWERS: readonly MockFormAnswer[] = [
  {
    id: "motivation",
    question: "Why are you interested in this role?",
    answer: "This opportunity aligns with the kind of thoughtful, collaborative work I want to pursue next. Before submitting, I would add one truthful example from my background that connects directly to the role."
  },
  {
    id: "strength",
    question: "What strength would you bring to this team?",
    answer: "I bring a structured, people-centered approach to ambiguous work. I would personalize this answer with a verified project from my saved profile and explain the practical outcome."
  },
  {
    id: "availability",
    question: "When would you be available to start?",
    answer: "I would enter my actual availability here and avoid estimating until I have confirmed my current commitments."
  }
];

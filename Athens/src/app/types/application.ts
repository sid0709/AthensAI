export interface Application {
  id: string;
  company: string;
  role: string;
  score: number;
  stage: string;
  tags: string[];
  source: string;
  time: string;
  email: string;
  location: string;
  salary?: string;
}

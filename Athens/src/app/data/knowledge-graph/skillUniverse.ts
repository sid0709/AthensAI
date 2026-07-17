import type { SkillEdge, SkillGraph, SkillNode } from "../../types/knowledgeGraph";

/**
 * The skill "universe" — a typed, weighted graph of technologies and concepts.
 *
 * This is the client-side stand-in for the Neo4j knowledge graph. Nodes map to
 * `(:Skill)` and edges map to typed relationships, so the shape can later be
 * produced verbatim by a Cypher query.
 */

export const SKILL_NODES: SkillNode[] = [
  // Concepts / categories (taxonomy anchors)
  { id: "frontend", label: "Frontend", category: "concept", blurb: "Client-side UI engineering." },
  { id: "backend", label: "Backend", category: "concept", blurb: "Server-side application logic." },
  { id: "cloud", label: "Cloud", category: "concept", blurb: "Cloud platforms and managed services." },
  { id: "data", label: "Data", category: "concept", blurb: "Data processing and analytics." },
  { id: "devops", label: "DevOps", category: "concept", blurb: "Build, deploy, and operate." },

  // Languages
  { id: "javascript", label: "JavaScript", category: "language", blurb: "The language of the web." },
  { id: "typescript", label: "TypeScript", category: "language", blurb: "Typed superset of JavaScript." },
  { id: "csharp", label: "C#", category: "language", blurb: "Primary language of the .NET platform." },
  { id: "python", label: "Python", category: "language", blurb: "General-purpose, data-friendly language." },
  { id: "go", label: "Go", category: "language", blurb: "Compiled language for services and tooling." },
  { id: "java", label: "Java", category: "language", blurb: "JVM language for enterprise systems." },
  { id: "rust", label: "Rust", category: "language", blurb: "Memory-safe systems language." },
  { id: "sql", label: "SQL", category: "language", blurb: "Query language for relational data." },

  // Frontend frameworks / libs
  { id: "react", label: "React", category: "frontend", blurb: "Component-based UI library." },
  { id: "nextjs", label: "Next.js", category: "frontend", blurb: "Full-stack React framework." },
  { id: "remix", label: "Remix", category: "frontend", blurb: "Web framework built on React + web standards." },
  { id: "vue", label: "Vue", category: "frontend", blurb: "Approachable reactive UI framework." },
  { id: "svelte", label: "Svelte", category: "frontend", blurb: "Compiler-based UI framework." },
  { id: "angular", label: "Angular", category: "frontend", blurb: "Batteries-included frontend framework." },
  { id: "blazor", label: "Blazor", category: "frontend", blurb: ".NET framework for interactive web UI." },
  { id: "tailwind", label: "Tailwind CSS", category: "frontend", blurb: "Utility-first CSS framework." },
  { id: "design-systems", label: "Design Systems", category: "frontend", blurb: "Reusable component standards." },

  // Backend frameworks / runtimes
  { id: "nodejs", label: "Node.js", category: "backend", blurb: "JavaScript runtime for servers." },
  { id: "express", label: "Express", category: "backend", blurb: "Minimal Node.js web framework." },
  { id: "dotnet", label: ".NET", category: "backend", blurb: "Cross-platform application platform." },
  { id: "aspnet", label: "ASP.NET Core", category: "backend", blurb: ".NET web application framework." },
  { id: "django", label: "Django", category: "backend", blurb: "Batteries-included Python web framework." },
  { id: "fastapi", label: "FastAPI", category: "backend", blurb: "Modern async Python API framework." },
  { id: "spring", label: "Spring", category: "backend", blurb: "Java application framework." },
  { id: "graphql", label: "GraphQL", category: "backend", blurb: "Query language for APIs." },

  // Cloud
  { id: "aws", label: "AWS", category: "cloud", blurb: "Amazon Web Services." },
  { id: "azure", label: "Azure", category: "cloud", blurb: "Microsoft cloud platform." },
  { id: "gcp", label: "GCP", category: "cloud", blurb: "Google Cloud Platform." },

  // DevOps
  { id: "docker", label: "Docker", category: "devops", blurb: "Container packaging and runtime." },
  { id: "kubernetes", label: "Kubernetes", category: "devops", blurb: "Container orchestration." },
  { id: "cicd", label: "CI/CD", category: "devops", blurb: "Continuous integration and delivery." },
  { id: "terraform", label: "Terraform", category: "devops", blurb: "Infrastructure as code." },

  // Databases
  { id: "postgresql", label: "PostgreSQL", category: "database", blurb: "Advanced relational database." },
  { id: "mysql", label: "MySQL", category: "database", blurb: "Popular relational database." },
  { id: "mongodb", label: "MongoDB", category: "database", blurb: "Document database." },
  { id: "redis", label: "Redis", category: "database", blurb: "In-memory data store." },
  { id: "neo4j", label: "Neo4j", category: "database", blurb: "Native graph database." },

  // Data
  { id: "pandas", label: "Pandas", category: "data", blurb: "Python data analysis library." },
  { id: "spark", label: "Spark", category: "data", blurb: "Distributed data processing engine." },
  { id: "pytorch", label: "PyTorch", category: "data", blurb: "Deep learning framework." },

  // Concepts / cross-cutting
  { id: "performance", label: "Performance", category: "concept", blurb: "Speed and efficiency engineering." },
  { id: "testing", label: "Testing", category: "concept", blurb: "Automated quality assurance." },
  { id: "system-design", label: "System Design", category: "concept", blurb: "Architecting scalable systems." },
];

/**
 * Typed relationships. `weight` is an authored base coupling in [0, 1]; the
 * activation engine also factors in a per-type multiplier and Hebbian
 * co-occurrence learned from active resumes.
 */
export const SKILL_EDGES: SkillEdge[] = [
  // --- JavaScript / TypeScript frontend chain ---
  { from: "javascript", to: "typescript", type: "PREREQUISITE_OF", weight: 0.9 },
  { from: "javascript", to: "react", type: "PREREQUISITE_OF", weight: 0.85 },
  { from: "typescript", to: "react", type: "USED_WITH", weight: 0.8 },
  { from: "react", to: "nextjs", type: "BUILDS_ON", weight: 0.9 },
  { from: "react", to: "remix", type: "BUILDS_ON", weight: 0.85 },
  { from: "react", to: "design-systems", type: "USED_WITH", weight: 0.7 },
  { from: "react", to: "tailwind", type: "USED_WITH", weight: 0.65 },
  { from: "nextjs", to: "remix", type: "RELATED_TO", weight: 0.6 },
  { from: "react", to: "vue", type: "RELATED_TO", weight: 0.5 },
  { from: "react", to: "svelte", type: "RELATED_TO", weight: 0.45 },
  { from: "react", to: "angular", type: "RELATED_TO", weight: 0.45 },
  { from: "vue", to: "svelte", type: "RELATED_TO", weight: 0.4 },
  { from: "react", to: "frontend", type: "PART_OF", weight: 0.8 },
  { from: "vue", to: "frontend", type: "PART_OF", weight: 0.8 },
  { from: "svelte", to: "frontend", type: "PART_OF", weight: 0.8 },
  { from: "angular", to: "frontend", type: "PART_OF", weight: 0.8 },
  { from: "blazor", to: "frontend", type: "PART_OF", weight: 0.8 },
  { from: "tailwind", to: "frontend", type: "PART_OF", weight: 0.6 },
  { from: "design-systems", to: "frontend", type: "PART_OF", weight: 0.6 },
  { from: "react", to: "performance", type: "USED_WITH", weight: 0.5 },
  { from: "react", to: "testing", type: "USED_WITH", weight: 0.5 },

  // --- Node.js backend chain ---
  { from: "javascript", to: "nodejs", type: "PREREQUISITE_OF", weight: 0.85 },
  { from: "typescript", to: "nodejs", type: "USED_WITH", weight: 0.7 },
  { from: "nodejs", to: "express", type: "BUILDS_ON", weight: 0.85 },
  { from: "nodejs", to: "graphql", type: "USED_WITH", weight: 0.55 },
  { from: "nodejs", to: "backend", type: "PART_OF", weight: 0.8 },
  { from: "express", to: "backend", type: "PART_OF", weight: 0.7 },
  { from: "react", to: "graphql", type: "USED_WITH", weight: 0.45 },

  // --- .NET ecosystem ---
  { from: "csharp", to: "dotnet", type: "PREREQUISITE_OF", weight: 0.92 },
  { from: "dotnet", to: "aspnet", type: "BUILDS_ON", weight: 0.9 },
  { from: "dotnet", to: "blazor", type: "BUILDS_ON", weight: 0.85 },
  { from: "csharp", to: "blazor", type: "USED_WITH", weight: 0.75 },
  { from: "dotnet", to: "azure", type: "USED_WITH", weight: 0.8 },
  { from: "aspnet", to: "azure", type: "USED_WITH", weight: 0.7 },
  { from: "blazor", to: "azure", type: "USED_WITH", weight: 0.6 },
  { from: "dotnet", to: "backend", type: "PART_OF", weight: 0.8 },
  { from: "aspnet", to: "backend", type: "PART_OF", weight: 0.75 },
  { from: "dotnet", to: "csharp", type: "USED_WITH", weight: 0.6 },

  // --- Python ecosystem ---
  { from: "python", to: "django", type: "BUILDS_ON", weight: 0.8 },
  { from: "python", to: "fastapi", type: "BUILDS_ON", weight: 0.8 },
  { from: "python", to: "pandas", type: "USED_WITH", weight: 0.8 },
  { from: "python", to: "pytorch", type: "USED_WITH", weight: 0.7 },
  { from: "django", to: "backend", type: "PART_OF", weight: 0.75 },
  { from: "fastapi", to: "backend", type: "PART_OF", weight: 0.75 },
  { from: "pandas", to: "data", type: "PART_OF", weight: 0.8 },
  { from: "spark", to: "data", type: "PART_OF", weight: 0.8 },
  { from: "pytorch", to: "data", type: "PART_OF", weight: 0.8 },
  { from: "python", to: "spark", type: "USED_WITH", weight: 0.55 },
  { from: "fastapi", to: "graphql", type: "RELATED_TO", weight: 0.4 },

  // --- JVM ecosystem ---
  { from: "java", to: "spring", type: "BUILDS_ON", weight: 0.85 },
  { from: "spring", to: "backend", type: "PART_OF", weight: 0.75 },
  { from: "java", to: "csharp", type: "RELATED_TO", weight: 0.5 },

  // --- Go / Rust ---
  { from: "go", to: "backend", type: "PART_OF", weight: 0.7 },
  { from: "go", to: "docker", type: "USED_WITH", weight: 0.5 },
  { from: "rust", to: "backend", type: "PART_OF", weight: 0.55 },
  { from: "go", to: "rust", type: "RELATED_TO", weight: 0.4 },

  // --- Cloud ---
  { from: "aws", to: "cloud", type: "PART_OF", weight: 0.85 },
  { from: "azure", to: "cloud", type: "PART_OF", weight: 0.85 },
  { from: "gcp", to: "cloud", type: "PART_OF", weight: 0.85 },
  { from: "aws", to: "azure", type: "RELATED_TO", weight: 0.5 },
  { from: "azure", to: "gcp", type: "RELATED_TO", weight: 0.5 },
  { from: "aws", to: "gcp", type: "RELATED_TO", weight: 0.5 },

  // --- DevOps ---
  { from: "docker", to: "kubernetes", type: "PREREQUISITE_OF", weight: 0.85 },
  { from: "docker", to: "devops", type: "PART_OF", weight: 0.8 },
  { from: "kubernetes", to: "devops", type: "PART_OF", weight: 0.8 },
  { from: "cicd", to: "devops", type: "PART_OF", weight: 0.8 },
  { from: "terraform", to: "devops", type: "PART_OF", weight: 0.75 },
  { from: "kubernetes", to: "aws", type: "USED_WITH", weight: 0.55 },
  { from: "kubernetes", to: "azure", type: "USED_WITH", weight: 0.55 },
  { from: "terraform", to: "aws", type: "USED_WITH", weight: 0.55 },
  { from: "docker", to: "cicd", type: "USED_WITH", weight: 0.6 },
  { from: "cicd", to: "testing", type: "USED_WITH", weight: 0.5 },

  // --- Databases ---
  { from: "sql", to: "postgresql", type: "PREREQUISITE_OF", weight: 0.8 },
  { from: "sql", to: "mysql", type: "PREREQUISITE_OF", weight: 0.8 },
  { from: "postgresql", to: "mysql", type: "RELATED_TO", weight: 0.55 },
  { from: "postgresql", to: "redis", type: "USED_WITH", weight: 0.45 },
  { from: "mongodb", to: "redis", type: "RELATED_TO", weight: 0.4 },
  { from: "postgresql", to: "mongodb", type: "RELATED_TO", weight: 0.4 },
  { from: "neo4j", to: "postgresql", type: "RELATED_TO", weight: 0.35 },
  { from: "nodejs", to: "mongodb", type: "USED_WITH", weight: 0.5 },
  { from: "nodejs", to: "postgresql", type: "USED_WITH", weight: 0.5 },
  { from: "django", to: "postgresql", type: "USED_WITH", weight: 0.6 },
  { from: "aspnet", to: "sql", type: "USED_WITH", weight: 0.5 },
  { from: "spark", to: "sql", type: "USED_WITH", weight: 0.45 },

  // --- Cross-cutting concepts ---
  { from: "system-design", to: "backend", type: "RELATED_TO", weight: 0.5 },
  { from: "system-design", to: "cloud", type: "RELATED_TO", weight: 0.45 },
  { from: "performance", to: "frontend", type: "RELATED_TO", weight: 0.4 },
  { from: "testing", to: "backend", type: "RELATED_TO", weight: 0.4 },
];

export const SKILL_GRAPH: SkillGraph = {
  nodes: SKILL_NODES,
  // Drop any edge that references a node id not present in the universe so the
  // fixture stays self-consistent even while it is being edited.
  edges: SKILL_EDGES.filter(
    (e) =>
      SKILL_NODES.some((n) => n.id === e.from) &&
      SKILL_NODES.some((n) => n.id === e.to) &&
      e.weight > 0,
  ),
};

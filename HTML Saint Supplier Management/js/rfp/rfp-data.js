/**
 * SAINT.rfpData — seed data + the mock RFP document generator.
 *
 * Ported from RFPPILOT (github.com/Cloudvita/RFPPILOT), a Streamlit prototype
 * that calls the Mistral API to expand a 10-question intake into a formal RFP,
 * with a documented graceful fallback to a template-based mock generator when
 * no API key is present. This static build only ever uses that fallback path —
 * calling a paid LLM API directly from browser code would mean shipping an API
 * key in public JavaScript, so it isn't done here. See README for wiring a
 * real backend endpoint in its place.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  const DEFAULT_VENDORS = [
    { name: "Apex Digital Solutions (Vendor A)", poc: "Sarah Jenkins (VP Enterprise)", email: "rfp-team@apexdigital.com" },
    { name: "Nexus Enterprise Systems (Vendor B)", poc: "Marcus Vance (Account Executive)", email: "proposals@nexussystems.com" },
    { name: "Vanguard Tech Innovations (Vendor C)", poc: "Elena Rostova (Client Director)", email: "enterprise-sales@vanguardtech.io" },
  ];

  const DEFAULT_PARAMETERS = [
    "Technical Alignment",
    "Cost / Value Proposition",
    "SLA & Support Model",
    "Security & Compliance",
    "Vendor Experience & Track Record",
    "Architecture Scalability",
    "Risk Profile & Governance",
    "Implementation Timeline",
  ];

  const DEFAULT_WEIGHTS = {
    "Technical Alignment": 0.2,
    "Cost / Value Proposition": 0.2,
    "SLA & Support Model": 0.15,
    "Security & Compliance": 0.15,
    "Vendor Experience & Track Record": 0.1,
    "Architecture Scalability": 0.1,
    "Risk Profile & Governance": 0.05,
    "Implementation Timeline": 0.05,
  };

  const INTAKE_QUESTIONS = [
    ["q1_outcomes", "1. Program Objectives / Top 3 Outcomes"],
    ["q2_scope", "2. Scope of Work & Core Deliverables"],
    ["q3_tech", "3. Technical & Architectural Requirements"],
    ["q4_timeline", "4. Project Timeline & Key Milestones"],
    ["q5_budget", "5. Budget Constraints & Payment Structure"],
    ["q6_sla", "6. Service Level Agreement (SLA) & Performance Limits"],
    ["q7_security", "7. Security, Compliance & Governance Standards"],
    ["q8_support", "8. Support Model & Escalation Protocols"],
    ["q9_qualifications", "9. Vendor Qualifications & Reference Requirements"],
    ["q10_pricing", "10. Pricing Structure & Rate Card Guidelines"],
  ];

  const DEFAULT_INTAKE = {
    q1_outcomes: "1. Modernize legacy workflow platform. 2. Achieve 99.99% system availability. 3. Reduce API latency under 100ms.",
    q2_scope: "Full cloud-native platform migration, API gateway setup, microservices restructuring, and automated CI/CD pipeline implementation.",
    q3_tech: "Python / FastAPI backend, React / TypeScript UI, PostgreSQL database, Docker & Kubernetes deployment, Kafka event streaming.",
    q4_timeline: "Target 6-month timeline: Phase 1 Architecture (Mo 1-2), Phase 2 Core Build (Mo 3-4), Phase 3 Testing & Go-Live (Mo 5-6).",
    q5_budget: "Target budget range: $200,000 - $300,000 with milestone payment release upon UAT acceptance.",
    q6_sla: "99.9% uptime guarantee, < 15 min response time for Critical P1 incidents, 24/7 dedicated engineering support escalation.",
    q7_security: "SOC 2 Type II certification mandatory, ISO 27001 compliance, GDPR compliance, AES-256 data encryption at rest and TLS 1.3 in transit.",
    q8_support: "Dedicated Technical Account Manager, monthly status reviews, guaranteed 4-hour resolution for P2 issues, quarterly patch upgrades.",
    q9_qualifications: "Minimum 5 years enterprise software integration experience, 3 verified customer references in financial or healthcare sectors.",
    q10_pricing: "Fixed-price milestone structure, transparent maintenance & licensing tier costs, itemized hourly rate for out-of-scope work.",
  };

  /** Template-expansion RFP generator — the same fallback RFPPILOT uses when no
   * Mistral API key is configured, ported 1:1 in spirit (not tied to any LLM). */
  function generateMockRfp(intake, title) {
    const g = (k, fallback) => (intake[k] && intake[k].trim()) || fallback;
    const ref = `RFP-SAINT-${Date.now()}`;
    const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

    return `# REQUEST FOR PROPOSAL (RFP)
## ${title || "Enterprise Solution & Strategic Partnership"}

**Document Reference:** ${ref}
**Date:** ${dateStr}
**Status:** Active Distribution

---

### 1. EXECUTIVE SUMMARY & OBJECTIVES
The Sponsor Organization is requesting proposals from qualified vendors to deliver an end-to-end solution alignment.

#### Core RFP Program Objectives:
${g("q1_outcomes", "Achieve operational efficiency, scale infrastructure, and lower total cost of ownership.")}

---

### 2. SCOPE OF WORK & SYSTEM BOUNDARIES
- **Primary Scope:** ${g("q2_scope", "End-to-end software integration, cloud migration, and workflow automation.")}
- **Implementation Methodology:** Agile development methodology with phased milestone validation.
- **Deliverables:** Technical architecture design, system integration, deployment scripts, documentation, and user enablement workshops.

---

### 3. TECHNICAL & SYSTEM REQUIREMENTS
- **Technical Architecture:** ${g("q3_tech", "REST APIs, microservices architecture, OAuth2 authentication, scalable databases.")}
- **Data Integrity & Interoperability:** Standardized JSON/REST APIs with modular microservices design.
- **Scalability:** System must handle continuous workload scaling with auto-recovery and zero-downtime deployments.

---

### 4. TIMELINE, PHASING & DELIVERABLES
- **Project Schedule & Key Milestones:** ${g("q4_timeline", "6-month delivery timeline with bi-weekly sprint reviews.")}
- **Phasing Plan:** Phase 1 (Discovery & Architecture) -> Phase 2 (Core Build & Integration) -> Phase 3 (UAT & Go-Live).

---

### 5. BUDGETARY CONSTRAINTS & COST STRUCTURE
- **Target Budget Frame:** ${g("q5_budget", "Target budget cap $250,000 with milestone-based payment schedules.")}
- **Pricing Breakdown:** ${g("q10_pricing", "Fixed-fee milestone payments with optional maintenance tier add-ons.")}
- **Billing Schedule:** Payment tied directly to verified milestone sign-offs.

---

### 6. SERVICE LEVEL AGREEMENTS (SLA) & SUPPORT MODEL
- **Uptime & Performance Guarantees:** ${g("q6_sla", "99.9% service uptime, < 15 min critical issue response time, 24/7 coverage.")}
- **Support Infrastructure:** ${g("q8_support", "Dedicated technical account manager, tier-3 engineering escalation, SLA guarantees.")}

---

### 7. SECURITY, COMPLIANCE & RISK MANAGEMENT
- **Regulatory Framework:** ${g("q7_security", "SOC 2 Type II, ISO 27001, GDPR compliance, end-to-end data encryption.")}
- **Data Protection:** Data must be encrypted both at rest (AES-256) and in transit (TLS 1.3).
- **Audit & Governance:** Mandatory annual penetration testing and compliance audit reports.

---

### 8. VENDOR QUALIFICATIONS & REFERENCES
- **Capabilities & Experience:** ${g("q9_qualifications", "5+ years enterprise track record, minimum 3 reference clients in fintech/healthcare.")}
- **Reference Checks:** Submit minimum 3 case studies of similar scale deployments.

---

### 9. SUBMISSION GUIDELINES & PROPOSAL INSTRUCTIONS
1. **Submission Format:** Electronic submission via official RFP portal or direct response upload.
2. **Response Structure:** Must include Executive Summary, Technical Response Grid, Pricing Schedule, and SLA Commitments.
3. **Evaluation Criteria:** Responses will be evaluated across Technical Alignment, Cost Value, SLA Guarantees, Compliance, and Vendor Track Record.
`;
  }

  SAINT.rfpData = {
    DEFAULT_VENDORS,
    DEFAULT_PARAMETERS,
    DEFAULT_WEIGHTS,
    INTAKE_QUESTIONS,
    DEFAULT_INTAKE,
    generateMockRfp,
  };
})(window);

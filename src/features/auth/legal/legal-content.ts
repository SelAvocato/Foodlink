export type LegalSection = {
  heading: string;
  paragraphs: string[];
};

export type LegalDocument = {
  title: string;
  version: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
};

export const TERMS_AND_CONDITIONS_CONTENT: LegalDocument = {
  title: "Terms and Conditions",
  version: "1.0",
  lastUpdated: "2026-11-26",
  intro:
    "Placeholder content. Replace this text with the organization's approved Terms and Conditions before production use.",
  sections: [
    {
      heading: "1. Acceptance of Terms",
      paragraphs: [
        "By creating a FoodLink account, you confirm that you have read, understood, and agree to these Terms and Conditions.",
        "If you do not agree, do not submit a registration application.",
      ],
    },
    {
      heading: "2. Account Registration and Review",
      paragraphs: [
        "Donor and Volunteer accounts require organization review before login access is granted.",
        "You must provide accurate information and valid proof documents during registration.",
      ],
    },
    {
      heading: "3. Responsible Use",
      paragraphs: [
        "You agree to use FoodLink only for lawful food recovery, donation, volunteer, and administrative activities.",
        "You must not submit false information, misuse accounts, or interfere with platform operations.",
      ],
    },
    {
      heading: "4. Food Safety and Compliance",
      paragraphs: [
        "Donors and Volunteers are responsible for following applicable food safety requirements and organization instructions.",
        "FoodLink and the host organization may reject, decline, or remove donations that do not meet safety or policy requirements.",
      ],
    },
    {
      heading: "5. Changes to These Terms",
      paragraphs: [
        "These Terms may be updated when required by the organization or by law. The version shown in this dialog identifies the current placeholder version.",
      ],
    },
  ],
};

export const DATA_PRIVACY_ACT_CONTENT: LegalDocument = {
  title: "Data Privacy Act Notice",
  version: "1.0",
  lastUpdated: "2026-11-26",
  intro:
    "Placeholder content. Replace this text with the organization's approved Data Privacy Act (RA 10173) notice before production use.",
  sections: [
    {
      heading: "1. Collection of Personal Information",
      paragraphs: [
        "FoodLink collects personal information needed for account registration, review, donation coordination, and platform security.",
        "This may include your name, contact details, address, account credentials, and submitted proof documents.",
      ],
    },
    {
      heading: "2. Use and Processing",
      paragraphs: [
        "Your information is processed to evaluate registration applications, manage approved accounts, coordinate donations, and maintain audit and safety records.",
        "Processing is performed in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173) and applicable organization policies.",
      ],
    },
    {
      heading: "3. Sharing and Access",
      paragraphs: [
        "Information is shared only with authorized personnel and users involved in relevant donation activities, as required for platform operations.",
        "FoodLink does not store names of individual beneficiaries in distribution reports.",
      ],
    },
    {
      heading: "4. Protection and Retention",
      paragraphs: [
        "Reasonable organizational, physical, and technical safeguards are applied to protect personal information.",
        "Information is retained only as needed for legitimate purposes, legal obligations, and audit requirements.",
      ],
    },
    {
      heading: "5. Your Rights",
      paragraphs: [
        "You may have rights under RA 10173, including rights to be informed, access, object, correction, and erasure, subject to applicable laws and legitimate requirements.",
        "For privacy concerns, contact the host organization through its official contact channels.",
      ],
    },
  ],
};

// TEMPORARY preview fixture: lets the preview render a saved run without the API. Removed after review.

export const DEMO_RUN = {
  "run_id": "150452-42f469",
  "question": "homestead exemption",
  "answer": "**Short answer:** AI drafting was unavailable for this question, so no synthesized answer was generated; the top retrieved authority is **C.R.S. Title 38, Article** [1] - review the key authorities below.\n\n### Key authorities\n- **C.R.S. Title 38, Article** [1] - co statute, cited by 1021\n- **Assignability and exemption of claims** [2] - statute, cited by 14\n- **Levy on homestead** [3] - statute, cited by 9\n- **C.R.S. Title 08, Article** [4] - co statute, cited by 899\n- **C.R.S. § 38-41-201** [5] - co statute, cited by 63\n\n### Caveat\nTemplate summary (offline mode) built only from retrieved authorities; verify against the full opinions.",
  "citations": [
    {
      "cited_by": 1021,
      "court": "",
      "date": "",
      "id": "C.R.S. Title 38, Article",
      "pagerank": 581.16,
      "path": [
        "C.R.S. § 38-41-201.5",
        "C.R.S. Title 38, Article"
      ],
      "ref": "[1]",
      "score": 15.86,
      "seed": false,
      "title": "C.R.S. Title 38, Article",
      "type": "co_statute",
      "url": ""
    },
    {
      "cited_by": 14,
      "court": "",
      "date": "2025",
      "id": "C.R.S. § 8-42-124",
      "pagerank": 2.37,
      "path": [
        "C.R.S. § 8-42-124"
      ],
      "ref": "[2]",
      "score": 11.12,
      "seed": true,
      "title": "Assignability and exemption of claims",
      "type": "statute",
      "url": "https://law.justia.com/codes/colorado/title-08/article-/section-8-42-124/"
    },
    {
      "cited_by": 9,
      "court": "",
      "date": "2025",
      "id": "C.R.S. § 38-41-206",
      "pagerank": 2.1,
      "path": [
        "C.R.S. § 38-41-206"
      ],
      "ref": "[3]",
      "score": 9.91,
      "seed": true,
      "title": "Levy on homestead",
      "type": "statute",
      "url": "https://law.justia.com/codes/colorado/title-38/article-/section-38-41-206/"
    },
    {
      "cited_by": 899,
      "court": "",
      "date": "",
      "id": "C.R.S. Title 08, Article",
      "pagerank": 637.77,
      "path": [
        "C.R.S. § 8-42-124",
        "C.R.S. Title 08, Article"
      ],
      "ref": "[4]",
      "score": 7.8,
      "seed": false,
      "title": "C.R.S. Title 08, Article",
      "type": "co_statute",
      "url": ""
    },
    {
      "cited_by": 63,
      "court": "",
      "date": "",
      "id": "C.R.S. § 38-41-201",
      "pagerank": 8.7,
      "path": [
        "C.R.S. § 38-41-206",
        "C.R.S. § 38-41-201"
      ],
      "ref": "[5]",
      "score": 5.16,
      "seed": false,
      "title": "C.R.S. § 38-41-201",
      "type": "co_statute",
      "url": ""
    },
    {
      "cited_by": 47,
      "court": "",
      "date": "",
      "id": "C.R.S. § 8-42-103",
      "pagerank": 7.5,
      "path": [
        "C.R.S. § 8-42-124",
        "C.R.S. § 8-42-103"
      ],
      "ref": "[6]",
      "score": 4.87,
      "seed": false,
      "title": "C.R.S. § 8-42-103",
      "type": "co_statute",
      "url": ""
    },
    {
      "cited_by": 7,
      "court": "",
      "date": "",
      "id": "C.R.S. § 14-14-102",
      "pagerank": 8.02,
      "path": [
        "C.R.S. § 8-42-124",
        "C.R.S. § 14-14-102"
      ],
      "ref": "[7]",
      "score": 3.08,
      "seed": false,
      "title": "C.R.S. § 14-14-102",
      "type": "co_statute",
      "url": ""
    },
    {
      "cited_by": 0,
      "court": "Colorado state court",
      "date": "1974-02-11",
      "id": "Thornburg v. Homestead Minerals Corp., 184 Colo. 141",
      "pagerank": 0.48,
      "path": [
        "Thornburg v. Homestead Minerals Corp., 184 Colo. 141"
      ],
      "ref": "[8]",
      "score": 3,
      "seed": true,
      "title": "Thornburg v. Homestead Minerals Corp.",
      "type": "caselaw",
      "url": "https://www.courtlistener.com/opinion/7884616/thornburg-v-homestead-minerals-corp/"
    }
  ],
  "edges": [
    {
      "dst": "C.R.S. Title 38, Article",
      "src": "C.R.S. § 38-41-201.5"
    },
    {
      "dst": "C.R.S. Title 38, Article",
      "src": "C.R.S. § 38-41-206"
    },
    {
      "dst": "C.R.S. § 38-41-201",
      "src": "C.R.S. § 38-41-206"
    },
    {
      "dst": "C.R.S. § 14-14-102",
      "src": "C.R.S. § 8-42-124"
    },
    {
      "dst": "C.R.S. Title 08, Article",
      "src": "C.R.S. § 8-42-124"
    },
    {
      "dst": "C.R.S. § 8-42-103",
      "src": "C.R.S. § 8-42-124"
    }
  ],
  "followups": [
    "What does the exemption cover on severed minerals?",
    "Does the levy reach the dwelling itself?"
  ]
} as const;

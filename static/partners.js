// Shared partner config: brand colors, logos (simple-icons, vendored) or styled wordmarks.
window.PARTNERS={
 daytona:{name:"Daytona",color:"#22d3a6",url:"https://app.daytona.io",powers:"Isolated sandbox running every agent, SurrealDB, CI and triage",open:"Open in Daytona"},
 surrealdb:{name:"SurrealDB",color:"#ff00a0",logo:"Surrealdb",url:"https://surrealist.app",powers:"Citation graph: RELATE edges expand retrieved authorities",open:"Open in Surrealist"},
 arize:{name:"Arize",color:"#a78bfa",url:"https://app.arize.com",powers:"OpenTelemetry trace for every agent step",open:"Open in Arize"},
 elevenlabs:{name:"ElevenLabs",color:"#f5f5f4",logo:"Elevenlabs",url:"https://elevenlabs.io/app",powers:"Voice: reads the short answer, hands-free loop, speech-to-text",open:"Open in ElevenLabs"},
 anthropic:{name:"Anthropic",color:"#d97757",logo:"Anthropic",url:"https://console.anthropic.com",powers:"Claude Haiku drafts the memo from retrieved authorities only",open:"Open Console"},
 octo:{name:"Octo",color:"#f59e0b",url:"https://octodb.design-bakery.com",powers:"Full-text passage retrieval over 804k opinion chunks",open:"Open in Octo"},
 acs:{name:"ACS",color:"#38bdf8",url:"/api/tasks",powers:"Agent seats, handoffs, task board and per-run audit records",open:"Open board"}};
window.partnerMark=function(k,px){const p=PARTNERS[k],L=window.LOGOS&&p.logo&&LOGOS[p.logo];px=px||48;
 const ic=L?`<svg viewBox="0 0 24 24" width="${px*0.9}" height="${px*0.9}" fill="${p.color}" style="flex:none"><path d="${L.path}"/></svg>`:"";
 return `<span style="display:inline-flex;align-items:center;gap:${px*0.25}px;font-weight:800;letter-spacing:-.02em;font-size:${px}px;line-height:1;color:${p.color}">${ic}${p.name}</span>`;};

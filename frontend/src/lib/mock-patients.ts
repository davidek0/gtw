import type { Metric, Patient, Status } from "./health-data";

type MetricEnds = {
  rhr: [number, number];
  sleep: [number, number];
  steps: [number, number];
  hrv: [number, number];
  feeling: [number, number];
};

function trend(start: number, end: number, variation: number) {
  return Array.from({ length: 30 }, (_, index) => {
    const progress = index / 29;
    const wobble = Math.sin(index * 1.37) * variation + Math.cos(index * 0.61) * variation * 0.35;
    return Math.round((start + (end - start) * progress + wobble) * 10) / 10;
  });
}

function metric(
  key: string,
  label: string,
  unit: string,
  ends: [number, number],
  range: [number, number],
  variation: number,
  patientNote: string,
  clinicalNote: string,
  lowerIsBetter = false,
): Metric {
  return {
    key,
    label,
    unit,
    values: trend(ends[0], ends[1], variation),
    range,
    patientNote,
    clinicalNote,
    lowerIsBetter,
  };
}

function metrics(status: Status, ends: MetricEnds): Metric[] {
  const copy = {
    stable: {
      rhr: [
        "Your resting pulse is settling into a comfortable rhythm.",
        "Resting heart rate remains within the personal baseline and is trending favourably.",
      ],
      sleep: [
        "Your sleep has become more consistent this month.",
        "Sleep duration is stable with no sustained negative deviation.",
      ],
      steps: [
        "You are building movement into more of your days.",
        "Daily movement is meeting or exceeding the recent baseline.",
      ],
      hrv: [
        "Your recovery signal is moving in a positive direction.",
        "HRV is stable to improving relative to the 30-day baseline.",
      ],
      feeling: [
        "Your check-ins show a steady improvement in how you feel.",
        "Self-reported wellbeing is stable with a positive trajectory.",
      ],
    },
    watch: {
      rhr: [
        "Your resting pulse has been a little higher lately, so keep recovery gentle.",
        "Resting heart rate shows a moderate upward deviation from baseline.",
      ],
      sleep: [
        "Sleep has dipped recently. A calmer evening routine may help.",
        "Sleep duration is below the personal range on several recent nights.",
      ],
      steps: [
        "Movement is a little lower this week; small walks still count.",
        "Daily steps have declined moderately from the 30-day baseline.",
      ],
      hrv: [
        "Your recovery signal suggests taking things a little easier.",
        "HRV is drifting below the expected personal range.",
      ],
      feeling: [
        "Your recent check-ins are lower, and it is worth keeping an eye on.",
        "Self-reported wellbeing has declined by one point over the period.",
      ],
    },
    risk: {
      rhr: [
        "Your resting pulse is notably higher. Please follow your care plan.",
        "Resting heart rate shows a sustained clinically relevant rise above baseline.",
      ],
      sleep: [
        "Sleep has been much shorter lately. Prioritise rest and recovery.",
        "Sleep duration is persistently below the expected personal range.",
      ],
      steps: [
        "Your activity has fallen sharply. Be gentle and follow your care plan.",
        "Daily movement has declined substantially alongside other warning signals.",
      ],
      hrv: [
        "Your recovery signal is under strain. Rest and check in with your care team.",
        "HRV shows a sustained decline below the established baseline.",
      ],
      feeling: [
        "Your check-ins show that you have been feeling worse recently.",
        "Self-reported wellbeing has declined and reinforces the telemetry alert.",
      ],
    },
  }[status];

  return [
    metric("rhr", "Resting heart rate", "bpm", ends.rhr, [55, 75], 1.2, copy.rhr[0], copy.rhr[1], true),
    metric("sleep", "Sleep", "h", ends.sleep, [7, 9], 0.25, copy.sleep[0], copy.sleep[1]),
    metric("steps", "Daily steps", "k", ends.steps, [6, 12], 0.45, copy.steps[0], copy.steps[1]),
    metric("hrv", "Heart-rate variability", "ms", ends.hrv, [35, 65], 2, copy.hrv[0], copy.hrv[1]),
    metric("feeling", "Daily feeling", "/5", ends.feeling, [3, 5], 0.18, copy.feeling[0], copy.feeling[1]),
  ];
}

export const mockPatients: Patient[] = [
  {
    id: "person-1",
    email: "artur@example.com",
    name: "Artur Rekstad",
    firstName: "Artur",
    age: 67,
    sex: "M",
    condition: "Förmaksflimmer och hypertoni",
    diagnoses: ["Förmaksflimmer", "Hypertoni"],
    status: "watch",
    streak: 9,
    headline: "Pulsen följs i realtid.",
    subhead: "Garmin-sändningen visas direkt i klinikvyn när monitorn är ansluten.",
    feelingQuote: "Känner mig okej men lite trött",
    feelingScore: 3,
    flags: [
      {
        level: "watch",
        title: "Puls vald för akut monitorering",
        detail: "Livedata jämförs med de lokalt valda demo-gränserna 100 och 120 bpm.",
      },
      {
        level: "stable",
        title: "Ingen ihållande akut signal i sparad data",
        detail: "Bedöm alltid aktuell puls tillsammans med symtom och klinisk kontext.",
      },
    ],
    clinicalNote:
      "Arturs puls är vald som akut livedata. Systemet markerar förhöjd nivå från 100 bpm och akut varning från 120 bpm. Gränserna är demospecifika och ersätter inte klinisk bedömning.",
    metrics: metrics("watch", {
      rhr: [68, 76],
      sleep: [7.1, 6.4],
      steps: [6.9, 5.8],
      hrv: [41, 34],
      feeling: [3.8, 3.1],
    }),
  },
  {
    id: "amelia-berg",
    email: "amelia@example.com",
    name: "Amelia Berg",
    firstName: "Amelia",
    age: 34,
    sex: "F",
    condition: "Post-viral fatigue",
    status: "stable",
    streak: 12,
    headline: "Your recovery is finding its rhythm.",
    subhead: "Sleep, movement and recovery have all improved over the last month.",
    feelingQuote: "More like myself again",
    feelingScore: 4,
    flags: [
      { level: "stable", title: "Recovery improving", detail: "HRV has risen steadily for three weeks." },
      { level: "stable", title: "Sleep on target", detail: "Seven of the last ten nights were within range." },
    ],
    clinicalNote: "Recovery indicators are improving together. Continue the current pacing plan and routine follow-up.",
    metrics: metrics("stable", { rhr: [70, 64], sleep: [6.4, 7.7], steps: [4.6, 7.8], hrv: [35, 50], feeling: [3, 4.4] }),
  },
  {
    id: "daniel-nyberg",
    email: "daniel@example.com",
    name: "Daniel Nyberg",
    firstName: "Daniel",
    age: 61,
    sex: "M",
    condition: "Cardiac rehabilitation",
    status: "stable",
    streak: 21,
    headline: "Your steady work is paying off.",
    subhead: "Your resting pulse is lower while daily movement remains consistent.",
    feelingQuote: "Stronger every week",
    feelingScore: 5,
    flags: [
      { level: "stable", title: "RHR within target", detail: "Resting pulse has remained in the prescribed range." },
      { level: "stable", title: "Activity consistent", detail: "Movement target met on 12 of the last 14 days." },
    ],
    clinicalNote: "All monitored indicators are stable or improving. Maintain the current rehabilitation programme.",
    metrics: metrics("stable", { rhr: [68, 61], sleep: [7, 7.5], steps: [6.2, 8.6], hrv: [38, 48], feeling: [3.7, 4.7] }),
  },
  {
    id: "erik-sund",
    email: "erik@example.com",
    name: "Erik Sund",
    firstName: "Erik",
    age: 56,
    sex: "M",
    condition: "Type 2 diabetes",
    status: "watch",
    streak: 8,
    headline: "A quieter week calls for a little extra care.",
    subhead: "Sleep and activity are below your usual pattern, but small steps can help.",
    feelingQuote: "A bit worn down",
    feelingScore: 3,
    flags: [
      { level: "watch", title: "Sleep declining", detail: "Five consecutive nights were below six and a half hours." },
      { level: "watch", title: "Movement below baseline", detail: "Steps are 24% below the previous four-week average." },
    ],
    clinicalNote: "Moderate decline across sleep, activity and HRV. Review again in 72 hours and contact if the pattern continues.",
    metrics: metrics("watch", { rhr: [64, 72], sleep: [7.1, 5.9], steps: [7.5, 5.4], hrv: [47, 37], feeling: [4.1, 3.1] }),
  },
  {
    id: "sofia-ek",
    email: "sofia@example.com",
    name: "Sofia Ek",
    firstName: "Sofia",
    age: 45,
    sex: "F",
    condition: "Long COVID",
    status: "watch",
    streak: 5,
    headline: "Your body is asking for a slower pace.",
    subhead: "Recovery has dipped slightly after several more active days.",
    feelingQuote: "Tired but managing",
    feelingScore: 3,
    flags: [
      { level: "watch", title: "HRV below range", detail: "Recovery signal has stayed below baseline for six days." },
      { level: "watch", title: "RHR trending upward", detail: "Resting pulse is seven beats above the monthly low." },
    ],
    clinicalNote: "Pattern suggests post-exertional strain. Reinforce pacing guidance and reassess recovery markers this week.",
    metrics: metrics("watch", { rhr: [66, 73], sleep: [7.4, 6.3], steps: [5.8, 4.4], hrv: [44, 32], feeling: [3.8, 3] }),
  },
  {
    id: "maya-lindstrom",
    email: "maya@example.com",
    name: "Maya Lindström",
    firstName: "Maya",
    age: 68,
    sex: "F",
    condition: "Hypertension",
    status: "risk",
    streak: 3,
    headline: "Several signals need attention today.",
    subhead: "Your resting pulse is elevated while sleep and recovery have fallen.",
    feelingQuote: "Breathless and low on energy",
    feelingScore: 2,
    flags: [
      { level: "risk", title: "Sustained RHR elevation", detail: "Resting pulse is 18 bpm above baseline for three days." },
      { level: "risk", title: "Multi-signal decline", detail: "Sleep, movement, HRV and wellbeing are worsening together." },
    ],
    clinicalNote: "Coordinated decline with sustained tachycardic trend. Contact within 24 hours and assess symptoms and medication adherence.",
    metrics: metrics("risk", { rhr: [67, 86], sleep: [7.2, 5.2], steps: [6.8, 3.1], hrv: [42, 23], feeling: [4, 2] }),
  },
  {
    id: "omar-hassan",
    email: "omar@example.com",
    name: "Omar Hassan",
    firstName: "Omar",
    age: 72,
    sex: "M",
    condition: "Atrial fibrillation",
    status: "risk",
    streak: 2,
    headline: "Your recent pulse pattern needs a closer look.",
    subhead: "Resting heart rate and recovery have moved outside your usual range.",
    feelingQuote: "Fluttering and unusually tired",
    feelingScore: 2,
    flags: [
      { level: "risk", title: "RHR above personal range", detail: "Resting readings have exceeded 85 bpm for four days." },
      { level: "risk", title: "Wellbeing decline", detail: "Two low check-ins coincide with the telemetry change." },
    ],
    clinicalNote: "New sustained deviation with reported palpitations and fatigue. Prioritise same-day clinical review according to local protocol.",
    metrics: metrics("risk", { rhr: [71, 91], sleep: [6.9, 5.5], steps: [5.7, 2.8], hrv: [36, 20], feeling: [3.8, 1.9] }),
  },
];

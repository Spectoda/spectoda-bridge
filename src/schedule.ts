import schedule from "node-schedule";
import { RRule, datetime, rrulestr } from "rrule";

let jobs: schedule.Job[] = [];

interface ActionSchedule {
  event: string;
  value: string | number;
}

function scheduleJob(date: Date, action: ActionSchedule) {
  const job = schedule.scheduleJob(date, function () {
    console.log("Scheduled action:", date);

    console.log("The answer to life:", action);
  });
  jobs.push(job);
}

function cleanSchedule() {
  jobs.forEach(job => job.cancel());
  jobs = [];
}

// "FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1;COUNT=1", "FREQ=HOURLY;INTERVAL=1;COUNT=1000000",
interface TimeRRules {
  start: string;
  duration: string;
  priority: number;
}

// let rrules: TimeRRules[] = [
//   { start: `DTSTART:20240116T090000Z\nFREQ=SECONDLY;INTERVAL=5;UNTIL=20240116T150000Z`, duration: "1h 5m", priority: 1 },
//   { start: `DTSTART:20240116T0130000Z\nFREQ=SECONDLY;INTERVAL=5;UNTIL=20240115T150000Z`, duration: "1h 5m", priority: 1 },
// ];

let rrules: TimeRRules[] = [
  // Order here means Priority of stuff

  { start: `DTSTART:20240116T103000Z\nRRULE:FREQ=SECONDLY;INTERVAL=1;COUNT=1`, duration: "1h 5m" },
  { start: `DTSTART:20240116T115500Z\nRRULE:FREQ=SECONDLY;INTERVAL=1;COUNT=1`, duration: "1h 5m" },
];

(() => {
  cleanSchedule();
  for (let rrule of rrules) {
    const parsedRRule = rrulestr(rrule.start);

    // Prevent infinite loop
    if (!parsedRRule.options.count) {
      parsedRRule.options.count = 10000;
    }

    const events = parsedRRule.all();

    for (let event of events) {
      if (event.getTime() > new Date().getTime()) {
        // Ensure event is in the future
        console.log("Scheduling", event);
        scheduleJob(event, { event: "toggl", value: 100 });
      } else {
        console.log("Skipping past event", event);
      }
    }
  }

  console.log("Scheduled jobs:", jobs.length);
})();

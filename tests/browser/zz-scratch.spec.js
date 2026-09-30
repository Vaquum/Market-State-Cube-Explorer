const { test, expect, observe, probeTools } = require("./fixtures.js");
const { addRecorder, openView } = require("./cells-support.js");
const A = "&vis=2&ap=slate2-8f7890f7";
for (const [name, profile, hash] of [
  ["flow window", "micro:mixed", "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24750~25500&r=0,0&mode=flow&sw=0.3~0.7" + A],
  ["dwell window", "micro:nonvalues", "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24750~25500&r=0,0&mode=dwell&sw=0.2~0.6" + A],
]) test(name, async ({ freshContext, fakeFor }) => {
  const fake = await fakeFor(profile);
  const context = await freshContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const probe = probeTools.forPage(page);
  await openView(page, fake, probe, hash);
  const surface = observe(page);
  await new Promise(r => setTimeout(r, 1500));
  console.log(name, JSON.stringify((await surface.chip("cells")).data));
  console.log(" keys footer", JSON.stringify(await surface.keys()));
  const d = await surface.details("cells");
  console.log(" fields", JSON.stringify(Object.fromEntries(Object.entries(d.fields).map(([k,v])=>[k,v.value]))), JSON.stringify(d.warnings));
  await context.close();
});

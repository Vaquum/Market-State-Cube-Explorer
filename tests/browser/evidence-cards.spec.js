"use strict";
// B68 (P7-S3 #86): fixed synthetic source support, explicit floor and ledger
// identities, and requested rewind. The fixture supplies reports, never expected rates.
const {test,expect}=require('./fixtures.js');
test.use({reducedMotion:'reduce',viewport:{width:1500,height:950}});
for(const days of [1800,420]) test(`${days} days: shared calendar intervals qualify or withhold without hiding distributions`,async({page,fakeFor,probe})=>{
  test.setTimeout(90000);
  const {evidenceFixture}=await import('../../tools/benchmark/evidence-fixture.mjs');
  const fake=await fakeFor(evidenceFixture(days));
  await page.goto(`${fake.url}/#w=30d&r=9,0&auto=0&vis=2&tab=continuations`); await probe.waitForReady();
  await page.locator('#ol-evidence-tab').click();
  const host=page.locator('#ol-evidence-intervals');
  await expect.poll(()=>host.getAttribute('data-bootstrap'),{timeout:60000}).not.toBeNull();
  const data=JSON.parse(await host.getAttribute('data-bootstrap'));
  expect(data.key[0]).toBe('seasonal-state@1');expect(data.key[1]).toBe('block-bootstrap@2');
  const results=Object.values(data.intervals).flatMap(parts=>Object.values(parts));
  if(days===1800){expect(data.fullMatched).toBeGreaterThanOrEqual(20);const finite=results.filter(x=>x.result.tag==='finite');expect(finite.length).toBeGreaterThan(0);for(const x of finite){expect(x.validDraws).toBeGreaterThanOrEqual(1800);expect(x.result.value[0]).toBeLessThan(x.result.value[1]);}}
  else{expect(data.fullMatched).toBeLessThan(20);expect(results.every(x=>x.result.tag!=='finite')).toBe(true);await expect(host).toContainText('20 full matched blocks');}
  const counts=JSON.parse(await page.locator('#ol-evidence-ledger .ol-ledger-content').getAttribute('data-counts'));
  expect(Object.values(counts.firstFailures).reduce((a,b)=>a+b,0)+counts.stateEligible).toBe(counts.starts);
  expect(counts.matching+counts.nonmatching).toBe(counts.stateEligible);
  expect(counts.baselineCompleted+counts.missingHorizon+counts.unfinished).toBe(counts.stateEligible);
  if(days===1800){
    // Filter/sort/page handlers consume the settled study, never its Promise.
    await page.locator('#ol-open-cases').click();
    await page.locator('#ol-case-filter').selectOption('reference');
    const rows=page.locator('#ol-case-list tr'); await expect(rows).toHaveCount(50);
    const first=await rows.first().textContent(); await page.locator('#ol-case-next').click();
    await expect(rows.first()).not.toHaveText(first);
    await page.locator('[data-case-sort="date"]').click(); await expect(rows).toHaveCount(50);
    await page.locator('#ol-case-filter').selectOption('failure');
    await expect(page.locator('#ol-case-definition')).toContainText('Non-modal POC outcomes');
    await expect(rows).not.toHaveCount(0);
    await page.locator('#ol-tab-cases').click();
    // A cached horizon must relinquish a cancelled in-flight job for another horizon.
    await page.locator('#ol-horizon').selectOption('4');
    await expect(page.locator('#ol-evidence')).toHaveAttribute('aria-busy','true');
    await page.locator('#ol-horizon').selectOption('1');
    await expect(page.locator('#ol-evidence')).toHaveAttribute('aria-busy','false');
    await page.locator('#ol-horizon').selectOption('4');
    await expect.poll(async()=>{const raw=await host.getAttribute('data-bootstrap');return raw?JSON.parse(raw).key[15]:null;},{timeout:60000}).toBe(4);
    await expect(page.locator('#ol-evidence')).toHaveAttribute('aria-busy','false');
  }
  const old=await host.getAttribute('data-bootstrap');
  await page.evaluate(()=>{location.hash='#w=30d&r=9,0&auto=0&vis=2&tab=continuations&replay=1&at=2026-09-20T08:00Z';});
  await expect.poll(()=>host.getAttribute('data-bootstrap')).not.toBe(old);
  await expect(page.locator('#ol-evidence')).toHaveAttribute('aria-busy','false',{timeout:60000});
  await expect.poll(()=>host.getAttribute('data-bootstrap'),{timeout:60000}).not.toBeNull();
  const after=JSON.parse(await host.getAttribute('data-bootstrap'));expect(after.key[8]).toBeLessThan(data.key[8]);
});

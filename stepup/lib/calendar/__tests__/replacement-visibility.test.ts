import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReplacementVisibility, replacementSeriesFamilyIds } from "../replacement-visibility.ts";
import { visibleCalendarItems, type CalendarViewItem } from "../occurrences.ts";

const item = (id: string, patch: Partial<CalendarViewItem> = {}): CalendarViewItem => ({
  id, recurrenceId:null, occurrenceKey:null, materializedLessonId:id,isMaterialized:true,studentId:id,participantIds:[id],
  studentName:id,level:"A1",lessonType:"individual",title:null,start:"2026-10-31T11:00:00Z",end:"2026-10-31T12:00:00Z",
  modality:"presencial",status:"scheduled",activityKind:"class",isRecurring:false,freedByLessonId:null,notes:null,...patch,
});
test("a replaced cancellation disappears; an unrelated simultaneous class is preserved",()=>{
  const all=[item("old",{status:"cancelled"}),item("new"),item("unrelated")];
  const result=applyReplacementVisibility(all,{lessons:[{originalLessonId:"old",replacementLessonId:"new",kind:"replaced",replacementActive:true}],series:[]});
  assert.deepEqual(visibleCalendarItems(result).map(i=>i.id),["new","unrelated"]);
  assert.equal(all[0].hiddenByReplacement,undefined,"input history is not mutated");
});
test("a moved original disappears even when the destination is outside the displayed week",()=>{
  const result=applyReplacementVisibility([item("source",{status:"rescheduled"})],{lessons:[{originalLessonId:"source",replacementLessonId:"outside",kind:"moved",replacementActive:true}],series:[]});
  assert.deepEqual(visibleCalendarItems(result),[]);
  assert.deepEqual(visibleCalendarItems([item("released",{occupiesSlot:false})]),[]);
});
test("a cancelled replacement does not hide an unrelated original cancellation",()=>{
  const result=applyReplacementVisibility([item("old",{status:"cancelled"})],{lessons:[{originalLessonId:"old",replacementLessonId:"new",kind:"replaced",replacementActive:false}],series:[]});
  assert.equal(visibleCalendarItems(result).length,1);
});
test("whole-series replacement hides only unregistered cancellations from its effective date, preserving completed history",()=>{
  const all=[item("anchor",{status:"cancelled",recurrenceId:"old-rule"}),item("future",{status:"cancelled",recurrenceId:"old-rule",start:"2026-11-07T11:00:00Z"}),
    item("history",{status:"completed",recurrenceId:"old-rule"}),item("draft",{recurrenceId:"old-rule"}),item("other",{status:"cancelled",recurrenceId:"other-rule"})];
  const result=applyReplacementVisibility(all,{lessons:[],series:[{originalLessonId:"anchor",replacementRuleId:"new-rule",replacedRuleIds:["old-rule"],effectiveDate:"2026-10-31"}]});
  assert.deepEqual(visibleCalendarItems(result).map(i=>i.id),["history","draft","other"]);
});
test("series family follows predecessor links, never student identity; cycles terminate",()=>{
  const family=replacementSeriesFamilyIds([{id:"a",supersedesRecurrenceId:null},{id:"b",supersedesRecurrenceId:"a"},{id:"c",supersedesRecurrenceId:"b"},{id:"other",supersedesRecurrenceId:null}],"b");
  assert.deepEqual([...family].sort(),["a","b","c"]);
  assert.equal(replacementSeriesFamilyIds([{id:"a",supersedesRecurrenceId:"b"},{id:"b",supersedesRecurrenceId:"a"}],"a").size,2);
});

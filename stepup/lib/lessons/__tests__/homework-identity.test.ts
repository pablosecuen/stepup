import { test } from "node:test";
import assert from "node:assert/strict";
import { homeworkTaskAliases, pendingHomeworkWithReviews } from "../homework-identity.ts";
import { getBlockingHomeworkTasks, homeworkReviewSelectionKey, type PendingHomeworkTask } from "../homework.ts";

const identity = { originRegistrationId: "web_lesson", legacyOriginRegistrationId: "mobile_lesson", studentId: "web_student", legacyStudentId: "mobile_student", individual: true };
const task: PendingHomeworkTask = { taskId:"individual:web_lesson:web_student",studentId:"web_student",description:"First line\nSecond line",dueDate:null,originLessonRegistrationId:"web_lesson",assignedAt:"2026-10-20T13:00:00Z" };
const aliases = new Map(homeworkTaskAliases(identity).map((alias) => [alias,task.taskId]));
const review = { task_id:"individual:mobile_lesson:mobile_student", outcome:"realizada" as const, reviewed_at:"2026-10-20T14:00:00Z",lesson_registration_id:"review_lesson" };

test("imported individual reviews resolve all old/new ID combinations without changing stored IDs", () => {
  assert.equal(aliases.size,4);
  assert.deepEqual(pendingHomeworkWithReviews([task],aliases,[review]),[]);
  assert.equal(review.task_id,"individual:mobile_lesson:mobile_student");
});
test("a review for an unrelated task does not close an assigned task", () => {
  assert.equal(pendingHomeworkWithReviews([task],aliases,[{...review,task_id:"individual:other:other"}]).length,1);
});
test("common task aliases are stable and scoped separately for each student by the repository", () => {
  const common={...task,taskId:"common:web_lesson"};
  const map=new Map(homeworkTaskAliases({...identity,individual:false}).map(a=>[a,common.taskId]));
  assert.deepEqual(pendingHomeworkWithReviews([common],map,[{...review,task_id:"common:mobile_lesson"}]),[]);
  assert.equal(pendingHomeworkWithReviews([common],map,[]).length,1);
});
test("partial and not-done saved answers are restored only for the registration being reopened", () => {
  for(const outcome of ["parcial","no_realizada"] as const){
    const rows=pendingHomeworkWithReviews([task],aliases,[{...review,outcome}],"review_lesson");
    assert.equal(rows[0].currentReviewOutcome,outcome);
    const selection={[homeworkReviewSelectionKey(task.taskId,task.studentId)]:rows[0].currentReviewOutcome!};
    assert.equal(getBlockingHomeworkTasks("class",rows,selection).length,0,"a truthful nonterminal answer allows saving");
    assert.equal(pendingHomeworkWithReviews([task],aliases,[{...review,outcome}],"new_lesson")[0].currentReviewOutcome,undefined);
  }
});
test("no review is invented when evidence is absent",()=>{
  const result=pendingHomeworkWithReviews([task],aliases,[],"new_lesson");
  assert.equal(result[0].currentReviewOutcome,undefined);
  assert.equal(getBlockingHomeworkTasks("class",result,{}).length,1);
});
test("new web-only assignments and ya_no_corresponde remain supported",()=>{
  const map=new Map(homeworkTaskAliases({...identity,legacyOriginRegistrationId:null,legacyStudentId:null}).map(a=>[a,task.taskId]));
  assert.deepEqual([...map.keys()],[task.taskId]);
  assert.equal(pendingHomeworkWithReviews([task],map,[{...review,task_id:task.taskId,outcome:"ya_no_corresponde"}]).length,0);
});

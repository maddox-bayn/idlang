import { test, expect } from "@playwright/test";

test("publish a new track lesson and review a written challenge", async ({page}) => {
  let createdTitle = "";
  let reviewed = false;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({json:{user:{id:"admin",role:"admin",display_name:"Reviewer"}}});
    if (path === "/api/learning/curriculum") return route.fulfill({json:[]});
    if (path === "/api/admin/curriculum") {
      const body = route.request().postDataJSON();
      expect(body.lesson.questions[0].correctAnswer).toBe("Nmaochi");
      createdTitle = body.lesson.title;
      return route.fulfill({json:{id:body.track.id}});
    }
    if (path === "/api/admin/challenges") {
      if (route.request().method() === "PATCH") {
        expect(route.request().postDataJSON()).toEqual({id:7,status:"accepted",feedback:"Good morning greeting."});
        reviewed = true;
        return route.fulfill({json:{saved:true}});
      }
      return route.fulfill({json:{items:reviewed ? [] : [{id:7,learner:"ada",prompt:"Describe a greeting.",response:"Nmaochi",status:"pending",feedback:""}],more:false}});
    }
    return route.fulfill({json:{}});
  });
  await page.goto("/admin#curriculum");
  await page.getByRole("button",{name:"Add lesson and track step"}).click();
  for (const [label,value] of Object.entries({"Track title":"Greetings","Track description":"Morning salutations","Track category":"Daily life","Lesson title":"At home","Lesson topic":"Family","Real-life Idoma challenge":"Write a greeting you used today.","Prompt":"Choose the morning greeting.","Choice 1":"Nmaochi","Choice 2":"Nmoo"})) {
    await page.getByLabel(label,{exact:true}).fill(value);
  }
  await page.getByLabel("Correct answer").selectOption("Nmaochi");
  await page.getByRole("button",{name:"Publish lesson"}).click();
  await expect(page.getByText("Lesson published to the learning path.")).toBeVisible();
  expect(createdTitle).toBe("At home");
  await page.getByRole("link",{name:"Learner tasks"}).click();
  await page.getByLabel("Feedback").fill("Good morning greeting.");
  await page.getByRole("button",{name:"Accept task"}).click();
  await expect(page.getByText("Feedback sent to learner.")).toBeVisible();
  expect(reviewed).toBeTruthy();
});

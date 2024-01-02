import { Parser } from "@json2csv/plainjs";
import Koa, { Context } from "koa";
import Router from "koa-router";
import postgres from "postgres";

const app = new Koa();
const router = new Router();

const sql = postgres(process.env.DB_URI!);

router.get("/export", async (ctx: Context) => {
  let { appId, search, models, tags, exportType } = ctx.query;

  if (typeof appId !== "string") {
    ctx.status = 422;

    ctx.body = {
      error: "Invalid input: You must provide a valid appId",
    };
    return;
  }

  if (models! instanceof Array || tags instanceof Array) {
    ctx.status = 422;
    ctx.body = {
      error: 'Invalid input: "models" and "tags" must be of type Array.',
    };
    return;
  }

  models = models?.split(",") || [];
  tags = tags?.split(",") || [];

  let searchFilter = sql``;
  if (search) {
    searchFilter = sql`and (
      r.input::text ilike ${"%" + search + "%"}
      or r.output::text ilike ${"%" + search + "%"}
      or r.error::text ilike ${"%" + search + "%"}
    )`;
  }

  let modelsFilter = sql``;
  if (models.length > 0) {
    modelsFilter = sql`and r.name =  any(${models})`;
  }

  let tagsFilter = sql``;
  if (tags.length > 0) {
    tagsFilter = sql`and r.tags && ${tags}`;
  }

  const rows = await sql`
    select
      r.created_at as time,
      r.name as model,
      case 
        when r.ended_at is not null then extract(epoch from (r.ended_at - r.created_at)) 
        else null 
      end as duration,
      coalesce(completion_tokens, 0) + coalesce(prompt_tokens, 0) as tokens,
      tags as tags,
      input as prompt,
      coalesce(output, error) as result
    from
      run r 
    where
      r.app = ${appId}
      and r.type = 'llm'
      ${modelsFilter}
      ${tagsFilter}
      ${searchFilter}
    order by
      r.created_at desc
  `;

  if (exportType === "csv") {
    const data = rows.length > 0 ? rows : [{}];
    const parser = new Parser();
    const csv = parser.parse(data);
    const buffer = Buffer.from(csv, "utf-8");

    ctx.set("Content-Type", "text/csv");
    ctx.set("Content-Disposition", 'attachment; filename="export.csv"');

    ctx.body = buffer;
  } else if (exportType === "jsonl") {
    const jsonl = rows.map((row) => JSON.stringify(row)).join("\n");
    const buffer = Buffer.from(jsonl, "utf-8");

    ctx.set("Content-Type", "application/jsonlines");
    ctx.set("Content-Disposition", 'attachment; filename="export.jsonl"');

    ctx.body = buffer;
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT!;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

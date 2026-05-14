import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Automation, AutomationID, Service as AutomationService } from "@/automation/automation"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
import { errors } from "../../error"

export const AutomationRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List automations",
        description: "List recurring local automations for the current directory.",
        operationId: "automation.list",
        responses: {
          200: {
            description: "List of automations",
            content: {
              "application/json": {
                schema: resolver(Automation.Info.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("AutomationRoutes.list", c, function* () {
          const svc = yield* AutomationService
          return yield* svc.list()
        }),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create automation",
        description: "Create a recurring local automation for the current directory.",
        operationId: "automation.create",
        responses: {
          ...errors(400),
          200: {
            description: "Created automation",
            content: {
              "application/json": {
                schema: resolver(Automation.Info),
              },
            },
          },
        },
      }),
      validator("json", Automation.CreateInput),
      async (c) =>
        jsonRequest("AutomationRoutes.create", c, function* () {
          const svc = yield* AutomationService
          return yield* svc.create(c.req.valid("json"))
        }),
    )
    .patch(
      "/:automationID",
      describeRoute({
        summary: "Update automation",
        description: "Update an existing automation.",
        operationId: "automation.update",
        responses: {
          ...errors(400, 404),
          200: {
            description: "Updated automation",
            content: {
              "application/json": {
                schema: resolver(Automation.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ automationID: AutomationID })),
      validator("json", Automation.UpdateInput),
      async (c) =>
        jsonRequest("AutomationRoutes.update", c, function* () {
          const svc = yield* AutomationService
          return yield* svc.update({
            automationID: c.req.valid("param").automationID,
            ...c.req.valid("json"),
          })
        }),
    )
    .delete(
      "/:automationID",
      describeRoute({
        summary: "Delete automation",
        description: "Delete an automation and its run history.",
        operationId: "automation.delete",
        responses: {
          ...errors(404),
          200: {
            description: "Automation deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ automationID: AutomationID })),
      async (c) =>
        jsonRequest("AutomationRoutes.delete", c, function* () {
          const svc = yield* AutomationService
          return yield* svc.remove(c.req.valid("param").automationID)
        }),
    )
    .post(
      "/:automationID/run",
      describeRoute({
        summary: "Run automation now",
        description: "Run an automation immediately and return the run record.",
        operationId: "automation.run",
        responses: {
          ...errors(404),
          200: {
            description: "Automation run",
            content: {
              "application/json": {
                schema: resolver(Automation.Run),
              },
            },
          },
        },
      }),
      validator("param", z.object({ automationID: AutomationID })),
      async (c) =>
        jsonRequest("AutomationRoutes.run", c, function* () {
          const svc = yield* AutomationService
          return yield* svc.runNow(c.req.valid("param").automationID)
        }),
    )
    .get(
      "/:automationID/runs",
      describeRoute({
        summary: "List automation runs",
        description: "List recent run records for an automation.",
        operationId: "automation.runs",
        responses: {
          ...errors(404),
          200: {
            description: "Automation runs",
            content: {
              "application/json": {
                schema: resolver(Automation.Run.array()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ automationID: AutomationID })),
      validator("query", z.object({ limit: z.coerce.number().int().min(1).max(100).optional() })),
      async (c) =>
        jsonRequest("AutomationRoutes.runs", c, function* () {
          const svc = yield* AutomationService
          return yield* svc.runs({
            automationID: c.req.valid("param").automationID,
            limit: c.req.valid("query").limit,
          })
        }),
    ),
)

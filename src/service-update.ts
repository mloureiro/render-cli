import type { Service, ServiceUpdate } from "./client.js";
import { UsageError } from "./context.js";

export interface UpdateFlags {
  rootDir?: string;
  buildCommand?: string;
  startCommand?: string;
  autoDeploy?: string;
}

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface UpdatePlan {
  changes: FieldChange[];
  body: ServiceUpdate;
}

const CONTAINER_RUNTIMES = new Set(["docker", "image"]);

function currentAutoDeployTrigger(service: Service): string {
  if (service.autoDeployTrigger) return service.autoDeployTrigger;
  return service.autoDeploy === "no" ? "off" : "commit";
}

export function planServiceUpdate(service: Service, flags: UpdateFlags): UpdatePlan {
  const given = Object.values(flags).some((value) => value !== undefined);
  if (!given) {
    throw new UsageError(
      "Nothing to update: pass --root-dir, --build-command, --start-command or --auto-deploy",
    );
  }

  const isStaticSite = service.type === "static_site";
  const runtime = service.serviceDetails?.runtime ?? "";
  const commandsGiven = flags.buildCommand !== undefined || flags.startCommand !== undefined;
  if (commandsGiven && CONTAINER_RUNTIMES.has(runtime)) {
    throw new UsageError(
      `${service.name} runs a ${runtime} image; build and start commands do not apply`,
    );
  }
  if (flags.startCommand !== undefined && isStaticSite) {
    throw new UsageError(`${service.name} is a static site; it has no start command`);
  }

  const native = service.serviceDetails?.envSpecificDetails ?? {};
  const changes: FieldChange[] = [];
  const body: ServiceUpdate = {};
  const record = (field: string, from: string | undefined, to: string) => {
    if ((from ?? "") === to) return false;
    changes.push({ field, from: from ?? "", to });
    return true;
  };

  if (flags.rootDir !== undefined && record("root dir", service.rootDir, flags.rootDir)) {
    body.rootDir = flags.rootDir;
  }

  if (flags.autoDeploy !== undefined) {
    if (flags.autoDeploy !== "yes" && flags.autoDeploy !== "no") {
      throw new UsageError("--auto-deploy must be yes or no");
    }
    const trigger = flags.autoDeploy === "yes" ? "commit" : "off";
    if (record("auto-deploy", currentAutoDeployTrigger(service), trigger)) {
      body.autoDeployTrigger = trigger;
    }
  }

  if (flags.buildCommand !== undefined) {
    const current = isStaticSite ? service.serviceDetails?.buildCommand : native.buildCommand;
    if (record("build command", current, flags.buildCommand)) {
      body.serviceDetails = isStaticSite
        ? { buildCommand: flags.buildCommand }
        : { envSpecificDetails: { buildCommand: flags.buildCommand } };
    }
  }

  if (
    flags.startCommand !== undefined &&
    record("start command", native.startCommand, flags.startCommand)
  ) {
    body.serviceDetails = {
      envSpecificDetails: {
        ...body.serviceDetails?.envSpecificDetails,
        startCommand: flags.startCommand,
      },
    };
  }

  return { changes, body };
}

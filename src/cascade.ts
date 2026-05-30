/**
 * FaultKey Cascade Attenuation Rule v1
 *
 * Reference: docs/cascade-rule.md
 * Citation: FK-METHOD-2026-002
 *
 * Premise (informal): when an agent acts as one link in a multi-agent chain,
 * its individual liability share should be sub-linearly reduced relative to
 * the same agent acting alone, because (a) the upstream agent could have
 * caught the fault before passing it down, and (b) the downstream agent had
 * an opportunity to refuse or warn before propagating it further. The
 * marginal mitigating power of each additional link diminishes — hence the
 * logarithmic form.
 *
 * Formal:
 *
 *   attenuation_multiplier(agent_i) = 1 / (1 + α · ln(1 + k_i))
 *
 * where:
 *   k_i = max(upstream_depth(i), downstream_depth(i))
 *   α  = 0.15  (default; configurable via opts.alpha)
 *
 * The freed share (1 − multiplier) is redistributed proportionally to the
 * upstream and downstream parties touching agent_i, so the total share sums
 * to 1.0 (mass conservation).
 *
 * Properties:
 *   - α = 0  → multiplier = 1 for all → no change (backwards compatible)
 *   - k_i = 0 → multiplier = 1 (single-agent incident is unaffected)
 *   - Monotone non-increasing in k_i (deeper chain → smaller individual share)
 *   - Sub-linear (ln) growth, not linear (k) — defensible empirical curve
 *   - Pure function of inputs; no randomness; deterministic.
 *
 * Defensibility: see docs/cascade-rule.md §4 for the case-law mapping
 * (chain-of-custody under Daubert; Hart & Honoré on remote-cause attenuation;
 * Article 25 EU AI Act on shared responsibility along the supply chain).
 */

export interface CascadeEvent {
  id: string;
  type: string;
  agent?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  caused_by?: string; // event id of upstream cause
}

export interface CascadeAgentRef {
  id: string;
  type?: string;
}

export interface CascadeAttenuationOptions {
  /** Strength of the attenuation. Default 0.15. Set to 0 to disable. */
  alpha?: number;
  /** Maximum depth to count. Default 10. Prevents unbounded growth on huge traces. */
  maxDepth?: number;
}

export interface AgentDepth {
  agent_id: string;
  upstream_depth: number;
  downstream_depth: number;
  k: number; // max(upstream, downstream)
  multiplier: number; // 1 / (1 + α · ln(1 + k))
}

export interface CascadeAttenuationOutput {
  applied: boolean;
  alpha: number;
  rule_version: "FK-METHOD-2026-002";
  agents: AgentDepth[];
  /** Map of agent_id → final attenuated share (sums to 1.0). */
  attenuated_shares: Record<string, number>;
  /** Map of agent_id → original share before attenuation (for diff). */
  original_shares: Record<string, number>;
  /** Total share redistributed by the rule (in [0,1]). */
  total_redistributed: number;
}

const DEFAULT_ALPHA = 0.15;
const DEFAULT_MAX_DEPTH = 10;

/**
 * Build an upstream/downstream graph from the events list, then for each
 * agent compute the longest upstream chain and the longest downstream chain
 * that touch it. k_i = max of the two.
 *
 * Cascade depth is counted by *agent transitions*, not raw event hops:
 * if events e1→e2→e3 all reference agent A, that's depth 0 for A. If
 * e1(A) → e2(B) → e3(C), that's depth 2 for A (downstream), depth 0 for
 * upstream, k=2.
 */
function computeAgentDepths(
  events: CascadeEvent[],
  agents: CascadeAgentRef[],
  maxDepth: number,
): Map<string, { upstream: number; downstream: number }> {
  const eventById = new Map<string, CascadeEvent>();
  for (const e of events) eventById.set(e.id, e);

  // Build downstream adjacency: cause → [effect_event_ids]
  const downstreamOfEvent = new Map<string, string[]>();
  for (const e of events) {
    if (e.caused_by && eventById.has(e.caused_by)) {
      const arr = downstreamOfEvent.get(e.caused_by) ?? [];
      arr.push(e.id);
      downstreamOfEvent.set(e.caused_by, arr);
    } else if (e.parent_span_id) {
      // Fallback: use OTel parent linkage when caused_by isn't supplied.
      const parentEvent = events.find((p) => p.span_id === e.parent_span_id);
      if (parentEvent) {
        const arr = downstreamOfEvent.get(parentEvent.id) ?? [];
        arr.push(e.id);
        downstreamOfEvent.set(parentEvent.id, arr);
      }
    }
  }

  // Build upstream adjacency: effect → [cause_event_ids]
  const upstreamOfEvent = new Map<string, string[]>();
  for (const [cause, effects] of downstreamOfEvent.entries()) {
    for (const eff of effects) {
      const arr = upstreamOfEvent.get(eff) ?? [];
      arr.push(cause);
      upstreamOfEvent.set(eff, arr);
    }
  }

  // For each agent, find the longest upstream / downstream chain of *distinct
  // agent transitions* through any event owned by that agent.
  const result = new Map<string, { upstream: number; downstream: number }>();

  for (const agent of agents) {
    const ownEvents = events.filter((e) => e.agent === agent.id);
    if (ownEvents.length === 0) {
      result.set(agent.id, { upstream: 0, downstream: 0 });
      continue;
    }

    let maxUp = 0;
    let maxDown = 0;

    // BFS upstream from each owned event, counting agent transitions.
    for (const start of ownEvents) {
      const upDepth = bfsAgentTransitions(
        start.id,
        upstreamOfEvent,
        eventById,
        agent.id,
        maxDepth,
      );
      if (upDepth > maxUp) maxUp = upDepth;

      const downDepth = bfsAgentTransitions(
        start.id,
        downstreamOfEvent,
        eventById,
        agent.id,
        maxDepth,
      );
      if (downDepth > maxDown) maxDown = downDepth;
    }

    result.set(agent.id, { upstream: maxUp, downstream: maxDown });
  }

  return result;
}

/**
 * Count agent transitions in a directed traversal. Each time the agent
 * field changes from one event to the next, that counts as +1 depth.
 */
function bfsAgentTransitions(
  startId: string,
  adj: Map<string, string[]>,
  eventById: Map<string, CascadeEvent>,
  startAgent: string,
  maxDepth: number,
): number {
  const visited = new Set<string>([startId]);
  let frontier: Array<{ eventId: string; lastAgent: string; depth: number }> = [
    { eventId: startId, lastAgent: startAgent, depth: 0 },
  ];
  let max = 0;

  while (frontier.length > 0) {
    const next: Array<{ eventId: string; lastAgent: string; depth: number }> = [];
    for (const node of frontier) {
      if (node.depth >= maxDepth) continue;
      const neighbours = adj.get(node.eventId) ?? [];
      for (const nbId of neighbours) {
        if (visited.has(nbId)) continue;
        visited.add(nbId);
        const nb = eventById.get(nbId);
        if (!nb) continue;
        const nbAgent = nb.agent ?? node.lastAgent;
        const newDepth = nbAgent !== node.lastAgent ? node.depth + 1 : node.depth;
        if (newDepth > max) max = newDepth;
        next.push({ eventId: nbId, lastAgent: nbAgent, depth: newDepth });
      }
    }
    frontier = next;
  }

  return max;
}

/**
 * Apply the Cascade Attenuation Rule to a share map.
 *
 * Input: { agent_id → share } that sums to 1.0
 * Output: a new map { agent_id → share } that also sums to 1.0,
 *         plus the per-agent depth/multiplier evidence.
 */
export function applyCascadeAttenuation(
  shares: Record<string, number>,
  events: CascadeEvent[],
  agents: CascadeAgentRef[],
  opts: CascadeAttenuationOptions = {},
): CascadeAttenuationOutput {
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (alpha === 0) {
    return {
      applied: false,
      alpha,
      rule_version: "FK-METHOD-2026-002",
      agents: agents.map((a) => ({
        agent_id: a.id,
        upstream_depth: 0,
        downstream_depth: 0,
        k: 0,
        multiplier: 1,
      })),
      attenuated_shares: { ...shares },
      original_shares: { ...shares },
      total_redistributed: 0,
    };
  }

  const depths = computeAgentDepths(events, agents, maxDepth);

  const agentDepths: AgentDepth[] = agents.map((a) => {
    const d = depths.get(a.id) ?? { upstream: 0, downstream: 0 };
    const k = Math.max(d.upstream, d.downstream);
    const multiplier = 1 / (1 + alpha * Math.log(1 + k));
    return {
      agent_id: a.id,
      upstream_depth: d.upstream,
      downstream_depth: d.downstream,
      k,
      multiplier: +multiplier.toFixed(6),
    };
  });

  // Apply attenuation: each agent's share is multiplied by its multiplier.
  // Compute the freed mass.
  const attenuated: Record<string, number> = {};
  let freedMass = 0;
  for (const ad of agentDepths) {
    const original = shares[ad.agent_id] ?? 0;
    const newShare = original * ad.multiplier;
    attenuated[ad.agent_id] = newShare;
    freedMass += original - newShare;
  }

  // Redistribute freedMass proportionally to agents weighted by their k
  // (deeper chain → more responsibility for the absorbed share, because
  // they had more opportunities to mitigate). We weight by (k_i + 1) so
  // single-agent incidents (k=0) still receive a proportional baseline.
  const weights = agentDepths.map((ad) => ad.k + 1);
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight > 0 && freedMass > 1e-9) {
    agentDepths.forEach((ad, i) => {
      const w = weights[i] ?? 0;
      const bonus = freedMass * (w / totalWeight);
      attenuated[ad.agent_id] = (attenuated[ad.agent_id] ?? 0) + bonus;
    });
  }

  // Round to 3 decimal places and adjust the largest share for any rounding error
  let roundedSum = 0;
  for (const id of Object.keys(attenuated)) {
    attenuated[id] = +(attenuated[id] ?? 0).toFixed(3);
    roundedSum += attenuated[id] ?? 0;
  }
  const drift = +(1 - roundedSum).toFixed(3);
  if (Math.abs(drift) > 0 && agentDepths.length > 0) {
    // Apply drift to agent with largest current share
    let maxId = agentDepths[0]!.agent_id;
    let maxVal = attenuated[maxId] ?? 0;
    for (const id of Object.keys(attenuated)) {
      if ((attenuated[id] ?? 0) > maxVal) {
        maxVal = attenuated[id] ?? 0;
        maxId = id;
      }
    }
    attenuated[maxId] = +((attenuated[maxId] ?? 0) + drift).toFixed(3);
  }

  return {
    applied: agentDepths.some((ad) => ad.k > 0),
    alpha,
    rule_version: "FK-METHOD-2026-002",
    agents: agentDepths,
    attenuated_shares: attenuated,
    original_shares: { ...shares },
    total_redistributed: +freedMass.toFixed(3),
  };
}

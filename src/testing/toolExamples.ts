import type { ToolExample } from '../contract/index.ts';

import type { InjectOptions, InjectableServer } from './injections.ts';
import { injectToolCall } from './injections.ts';

/**
 * The call a model makes for an example question.
 */
export interface ToolExampleCall {
  /**
   * The tool, one the example names.
   */
  tool: string;
  /**
   * Its arguments.
   */
  arguments: Record<string, unknown>;
}

/**
 * Options of {@link checkToolExamples}.
 */
export interface CheckToolExamplesOptions extends InjectOptions {
  /**
   * The server's example questions, as `createToolRoutes()` takes them.
   */
  examples: readonly ToolExample[];
  /**
   * The call a model makes for each question, by question.
   */
  calls: Readonly<Record<string, ToolExampleCall>>;
  /**
   * The server, the tool routes registered.
   */
  app: InjectableServer;
}

/**
 * Answer every example question without a model: run the call a model makes
 * for it, and check that the result already holds every text a correct
 * answer contains (ignoring case). The calls run one after the other, as a
 * server limits the calls it runs at once. Each problem is one sentence
 * naming its question: a question without a call, a call without a
 * question, a call to a tool the example does not name, a call that is not
 * answered, or a text the result lacks.
 * @param options - The examples, their calls and the server.
 * @returns The problems; none when every example is answered.
 */
export async function checkToolExamples(
  options: CheckToolExamplesOptions,
): Promise<string[]> {
  const { examples, calls } = options;
  const problems: string[] = [];
  const questions = new Set(examples.map(({ question }) => question));
  for (const question of Object.keys(calls)) {
    if (!questions.has(question)) {
      problems.push(`"${question}" has a call, but is no example.`);
    }
  }
  await checkInOrder(options, 0, problems);
  return problems;
}

async function checkInOrder(
  options: CheckToolExamplesOptions,
  index: number,
  problems: string[],
): Promise<void> {
  const example = options.examples[index];
  if (example === undefined) return;
  problems.push(...(await checkExample(example, options)));
  await checkInOrder(options, index + 1, problems);
}

async function checkExample(
  example: ToolExample,
  options: CheckToolExamplesOptions,
): Promise<string[]> {
  const { question, tools } = example;
  const call = options.calls[question];
  if (call === undefined) return [`"${question}" has no call.`];
  const problems: string[] = [];
  if (!tools.includes(call.tool)) {
    problems.push(
      `"${question}" calls ${call.tool}, which the example does not name (${tools.join(', ')}).`,
    );
  }
  const response = await injectToolCall(
    options.app,
    call.tool,
    call.arguments,
    options,
  );
  const body = readJson(response.body);
  if (response.statusCode !== 200) {
    return [
      ...problems,
      `"${question}": ${call.tool} answered ${response.statusCode}: ${refusalText(body, response.body)}`,
    ];
  }
  const text = JSON.stringify(resultOf(body)).toLowerCase();
  const expected =
    typeof example.expect === 'string' ? [example.expect] : example.expect;
  for (const value of expected) {
    if (!text.includes(value.toLowerCase())) {
      problems.push(`"${question}": the result does not contain "${value}".`);
    }
  }
  return problems;
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function resultOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'result' in body
    ? body.result
    : null;
}

function refusalText(body: unknown, raw: string): string {
  return typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
    ? body.error
    : raw;
}

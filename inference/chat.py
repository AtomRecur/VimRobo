"""Transport the evaluation conversation to an OpenAI-compatible chat endpoint."""

import json

from vimrobo.memory.embeddings import post_json
from .prompts import CODA_ANSWER_FORMAT_ADDENDUM, INITIAL_PROMPT, SUMMARY_PROMPT

ROOT_TOOL = {
    "type": "function",
    "function": {
        "name": "initialize_root",
        "parameters": {
            "type": "object",
            "properties": {
                "node_id": {"type": "string"},
                "content": {"type": "string"},
                "question_skills": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 6},
            },
            "required": ["content", "question_skills"],
        },
    },
}
GRAPH_TOOLS = [{'type': 'function',
  'function': {'name': 'search_by_position',
               'parameters': {'type': 'object',
                              'properties': {'query_position': {'type': 'array',
                                                                'items': {'type': 'number'},
                                                                'minItems': 2,
                                                                'maxItems': 2},
                                             'parent_ids': {'type': 'array', 'items': {'type': 'string'}},
                                             'node_id': {'type': 'string'}},
                              'required': ['query_position', 'parent_ids', 'node_id']}}},
 {'type': 'function',
  'function': {'name': 'search_by_time',
               'parameters': {'type': 'object',
                              'properties': {'query_time': {'type': ['string', 'number']},
                                             'parent_ids': {'type': 'array', 'items': {'type': 'string'}},
                                             'node_id': {'type': 'string'}},
                              'required': ['query_time', 'parent_ids', 'node_id']}}},
 {'type': 'function',
  'function': {'name': 'search_by_target',
               'parameters': {'type': 'object',
                              'properties': {'query': {'type': 'string'},
                                             'sort_by': {'type': 'string',
                                                         'enum': ['semantic', 'nearest', 'closest_time']},
                                             'query_position': {'type': 'array',
                                                                'items': {'type': 'number'},
                                                                'minItems': 2,
                                                                'maxItems': 2},
                                             'query_time': {'type': ['string', 'number']},
                                             'parent_ids': {'type': 'array', 'items': {'type': 'string'}},
                                             'node_id': {'type': 'string'}},
                              'required': ['query', 'sort_by', 'parent_ids', 'node_id']}}},
 {'type': 'function',
  'function': {'name': 'summarize_intermediate_node',
               'parameters': {'type': 'object',
                              'properties': {'summary': {'type': 'string'},
                                             'observations': {'type': 'array',
                                                              'items': {'type': 'object',
                                                                        'properties': {'time': {'type': ['string',
                                                                                                         'number',
                                                                                                         'null']},
                                                                                       'position': {'anyOf': [{'type': 'array',
                                                                                                               'items': {'type': 'number'},
                                                                                                               'minItems': 2,
                                                                                                               'maxItems': 2},
                                                                                                              {'type': 'null'}]},
                                                                                       'status': {'type': 'string',
                                                                                                  'enum': ['target',
                                                                                                           'distractor',
                                                                                                           'unclear']},
                                                                                       'caption': {'type': 'string'}},
                                                                        'required': ['time',
                                                                                     'position',
                                                                                     'status',
                                                                                     'caption']}}},
                              'required': ['summary', 'observations']}}},
 {'type': 'function',
  'function': {'name': 'add_answer_node',
               'parameters': {'type': 'object',
                              'properties': {'parent_ids': {'type': 'array', 'items': {'type': 'string'}},
                                             'type': {'type': 'string',
                                                      'enum': ['general', 'position', 'time']},
                                             'answer': {}},
                              'required': ['parent_ids', 'type', 'answer']}}}]


def nonempty(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be nonempty text")
    return value.strip()


def native_tools(messages):
    system = messages[0]["content"]
    if system == INITIAL_PROMPT:
        return [ROOT_TOOL]
    if system == CODA_ANSWER_FORMAT_ADDENDUM:
        return []
    summary = messages[-1].get("content") == SUMMARY_PROMPT
    return [tool for tool in GRAPH_TOOLS if (tool["function"]["name"] == "summarize_intermediate_node") == summary]


class ChatClient:
    def __init__(self, transport, model, *, max_tokens=8192, temperature=0.7, tool_mode="xml", extra=None):
        self.transport = transport
        self.model = nonempty(model, "model")
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.extra = dict(extra or {})
        if tool_mode not in ("xml", "native"):
            raise ValueError("tool mode must be xml or native")
        self.tool_mode = tool_mode
        reserved = {"model", "messages", "stream", "tools", "tool_choice", "max_tokens", "temperature"}
        if reserved.intersection(self.extra):
            raise ValueError("chat extras must not override model, messages, tools, or sampling flags")

    async def request(self, messages, return_type="message"):
        payload = {
            "chat_template_kwargs": {"enable_thinking": False}, "top_p": 0.8, "top_k": 20,
            "min_p": 0.0, "presence_penalty": 1.5, "repetition_penalty": 1.0, **self.extra,
            "model": self.model, "messages": messages, "max_tokens": self.max_tokens,
            "temperature": self.temperature,
        }
        if self.tool_mode == "native":
            tools = native_tools(messages)
            if tools:
                payload.update(tools=tools, tool_choice="required")
        response = post_json(self.transport, "chat/completions", payload)
        try:
            message = response["choices"][0]["message"]
            if not isinstance(message, dict):
                raise TypeError
            if self.tool_mode == "native" and message.get("tool_calls"):
                call = message["tool_calls"][0]["function"]
                arguments = call["arguments"]
                action = {"name": call["name"], "arguments": json.loads(arguments) if isinstance(arguments, str) else arguments}
                message = {**message, "content": "<tool_call>" + json.dumps(action) + "</tool_call>"}
        except (IndexError, KeyError, TypeError) as error:
            raise ValueError("chat endpoint returned no valid message") from error
        return message if return_type == "message" else message.get("content", "")

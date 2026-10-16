"""Try to create an Arize online (continuous) LLM-judge task using InferHub as a custom OpenAI-compatible provider."""
import os
from arize import ArizeClient
from arize._generated.api_client.models import (AiIntegrationProvider, TemplateConfigInput, EvaluatorLlmConfigRequest,
    InvocationParamsRequest, ProviderParamsRequest, SpanEvaluatorInput, TaskEvaluatorInput, TaskType)
S = os.environ["ARIZE_SPACE_ID"]; P = os.environ.get("ARIZE_PROJECT_NAME", "precedent-legal-graphrag"); M = "deepseek-v4.1-flash"
c = ArizeClient(api_key=os.environ["ARIZE_API_KEY"])
def step(n, f):
    try: r = f(); print(n, "OK", getattr(r, "id", "")); return r
    except Exception as e: print(n, "FAILED", type(e).__name__, str(e).replace(os.environ["INFERHUB_API_KEY"], "[REDACTED]")[:300]); return None
integ = step("ai_integration", lambda: c.ai_integrations.create(name="inferhub", provider=AiIntegrationProvider.CUSTOM,
    api_key=os.environ["INFERHUB_API_KEY"], base_url="https://api.inferhub.dev/v1", model_names=[M], enable_default_models=False))
if integ:
    tmpl = ("You are judging a Colorado legal research assistant. Is the ANSWER fully supported by the RETRIEVED PASSAGES?\n"
            "QUESTION: {input}\nRETRIEVED PASSAGES: {documents}\nANSWER: {output}\nRespond with one word: grounded or ungrounded.")
    ev = step("template_evaluator", lambda: c.evaluators.create_template_evaluator(name="judge_groundedness_online", space=S, commit_message="InferHub deepseek-v4.1-flash",
        template_config=TemplateConfigInput(name="judge_groundedness_online", template=tmpl, include_explanations=True, use_function_calling=False,
            classification_choices={"grounded": 1, "ungrounded": 0},
            llm_config=EvaluatorLlmConfigRequest(ai_integration_id=integ.id, model_name=M,
                invocation_parameters=InvocationParamsRequest(), provider_parameters=ProviderParamsRequest()))))
    if ev:
        eid = getattr(ev, "id", None) or ev.evaluator.id
        step("continuous_task", lambda: c.tasks.create_evaluation_task(name="judge_online_inferhub", task_type=TaskType.TEMPLATE_EVALUATION, project=P, space=S,
            sampling_rate=1.0, is_continuous=True, query_filter="name = 'pipeline'",
            evaluators=[TaskEvaluatorInput(SpanEvaluatorInput(evaluator_id=eid, column_mappings={"input": "attributes.input.value", "output": "attributes.output.value", "documents": "attributes.input.value"}))]))

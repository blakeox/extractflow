from __future__ import annotations


def build_template_definition() -> dict:
    return {
        "template_name": "Invoice Extraction",
        "template_version": "1.0.0",
        "document_type": "invoice",
        "description": "Test template for extraction and review flows.",
        "llm_provider_settings": {
            "mode": "local",
            "provider_type": "mock",
            "base_url": None,
            "model": "mock-extractor",
            "temperature": 0.1,
            "max_tokens": 4000,
            "supports_json_mode": True,
            "allow_external_processing": False,
            "timeout_seconds": 120,
            "retry_count": 2,
            "chunk_size": 16000,
        },
        "langextract_config": {
            "prompt_description": (
                "Extract the vendor name and total invoice amount exactly as they appear in the document. "
                "Keep extractions grounded to verbatim source text and preserve order of appearance."
            ),
            "examples": [
                {
                    "text": "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00",
                    "extractions": [
                        {
                            "extraction_class": "vendor_name",
                            "extraction_text": "Acme Corp",
                            "attributes": {"value": "Acme Corp"},
                        },
                        {
                            "extraction_class": "total_amount",
                            "extraction_text": "$1,200.00",
                            "attributes": {"currency": "USD"},
                        },
                    ],
                }
            ],
        },
        "extracted_fields": [
            {
                "name": "vendor_name",
                "label": "Vendor Name",
                "description": "Vendor listed on the invoice.",
                "type": "text",
                "required": True,
                "citation_required": True,
                "validation": {"allow_null": False},
            },
            {
                "name": "total_amount",
                "label": "Total Amount",
                "description": "Invoice total.",
                "type": "currency",
                "required": True,
                "citation_required": True,
                "validation": {"allow_null": False, "currency": "USD"},
            },
        ],
        "calculated_fields": [
            {
                "name": "amount_with_buffer",
                "label": "Amount With Buffer",
                "description": "Ten percent buffer on invoice total.",
                "type": "calculated",
                "output_type": "currency",
                "formula": "coalesce(total_amount.amount, 0) * 1.10",
                "depends_on": ["total_amount"],
                "validation": {"allow_null": False, "min": 0},
            }
        ],
        "output_settings": {"export_formats": ["json", "csv", "excel"]},
    }

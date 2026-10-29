"""本机复核模型输出：只实现结构化输出用得到的 JSON Schema 子集（type/properties/required/
additionalProperties:false/enum/const/items/anyOf）。外加一条：名为 confidence 的数字必须在 0 到 1 之间。
"""

_TYPES = {
    'object': lambda v: isinstance(v, dict),
    'array': lambda v: isinstance(v, list),
    'string': lambda v: isinstance(v, str),
    'integer': lambda v: isinstance(v, int) and not isinstance(v, bool),
    'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    'boolean': lambda v: isinstance(v, bool),
    'null': lambda v: v is None,
}


class SchemaError(ValueError):
    pass


def validate(value, schema, path='$'):
    if 'anyOf' in schema:
        for option in schema['anyOf']:
            try:
                validate(value, option, path)
                return
            except SchemaError:
                continue
        raise SchemaError(f'{path}: matches no anyOf option')
    kind = schema.get('type')
    if kind is not None:
        kinds = kind if isinstance(kind, list) else [kind]
        if not any(_TYPES[k](value) for k in kinds):
            raise SchemaError(f'{path}: expected {kind}')
    if 'const' in schema and value != schema['const']:
        raise SchemaError(f'{path}: expected const')
    if 'enum' in schema and value not in schema['enum']:
        raise SchemaError(f'{path}: not in enum')
    if isinstance(value, dict):
        props = schema.get('properties', {})
        for key in schema.get('required', ()):
            if key not in value:
                raise SchemaError(f'{path}: missing {key}')
        if schema.get('additionalProperties') is False:
            extra = set(value) - set(props)
            if extra:
                raise SchemaError(f'{path}: unexpected {sorted(extra)}')
        for key, sub in props.items():
            if key in value:
                validate(value[key], sub, f'{path}.{key}')
        conf = value.get('confidence')
        if isinstance(conf, (int, float)) and not isinstance(conf, bool) and not 0 <= conf <= 1:
            raise SchemaError(f'{path}.confidence: out of range')
    if isinstance(value, list) and 'items' in schema:
        for i, item in enumerate(value):
            validate(item, schema['items'], f'{path}[{i}]')


def check_api_subset(schema, path='$'):
    """模板自检：结构化输出要求每个 object 都写 additionalProperties:false，且不支持数值/长度约束。"""
    banned = {'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength',
              'minItems', 'maxItems', 'pattern'}
    hit = banned & set(schema)
    if hit:
        raise SchemaError(f'{path}: unsupported keywords {sorted(hit)}')
    if schema.get('type') == 'object' and schema.get('additionalProperties') is not False:
        raise SchemaError(f'{path}: object needs additionalProperties: false')
    for key, sub in schema.get('properties', {}).items():
        check_api_subset(sub, f'{path}.{key}')
    if 'items' in schema:
        check_api_subset(schema['items'], f'{path}[]')
    for i, sub in enumerate(schema.get('anyOf', ())):
        check_api_subset(sub, f'{path}|{i}')

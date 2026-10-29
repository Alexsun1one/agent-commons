"""密钥：只从部署环境变量 COMMONS_AI_<服务商>_KEY 读，调用时才读，不缓存到模块里、不进日志、审计、异常和回包。

测试和开发一律给 Gateway(env={...}) 注入假值，不碰宿主环境变量。
"""
import os

ENV_VARS = ('COMMONS_AI_ANTHROPIC_KEY',)
MASK = '[已隐藏]'


def lookup(env_name, env=None):
    if not env_name:
        return None
    source = os.environ if env is None else env
    value = (source.get(env_name) or '').strip()
    return value or None


def configured(env_name, env=None):
    return lookup(env_name, env) is not None


def scrub(text, secrets):
    """把文本里出现的密钥替换掉。只用于万一要落盘的短串（错误详情等），正常路径本来就不带密钥。"""
    if not isinstance(text, str):
        return text
    for secret in secrets:
        if secret and len(secret) >= 8:
            text = text.replace(secret, MASK)
    return text

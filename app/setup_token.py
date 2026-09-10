import secrets
from pathlib import Path


def main():
    directory = Path(__file__).resolve().parent.parent / '.local-state'
    directory.mkdir(exist_ok=True)
    token_file = directory / 'token.txt'
    if not token_file.exists():
        token_file.write_text(secrets.token_urlsafe(32), encoding='utf-8')
    if len(token_file.read_text(encoding='utf-8').strip()) < 32:
        raise ValueError('Existing token is invalid; replace .local-state/token.txt with a new random token.')
    print('Connection token is stored in .local-state/token.txt (not printed).')


if __name__ == '__main__':
    main()

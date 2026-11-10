# Referencia de comandos

[English](../cli-reference.md) | **Español**

Los comandos hacen el mismo trabajo que la app y el panel web.

## Correr un comando

Desde la carpeta `manimrs-studio`:

```powershell
.\studio <comando>
```

Desde la carpeta de charlas:

```powershell
uv run --no-project manimrs-studio/engine/studio.py <comando>
```

El motor usa solo la biblioteca estándar de Python. No necesita un entorno de proyecto.

## Comandos para la lista de charlas

| Comando | Resultado |
| --- | --- |
| `studio` | Abre el panel web en el navegador. |
| `studio panel --no-browser` | Arranca el panel web sin abrir el navegador. |
| `studio talks [--json]` | Lista las charlas con la carpeta de cada una. |
| `studio open <carpeta> [--json]` | Agrega a la lista la charla que está en `<carpeta>`. |
| `studio new-talk "<título>" [opciones]` | Crea una charla con una diapositiva de título y una de cierre. |
| `studio help` | Muestra la ayuda. |

Opciones de `new-talk`:

| Opción | Por defecto | Resultado |
| --- | --- | --- |
| `--about "<texto>"` | vacío | De qué trata la charla. |
| `--language <código>` | `es` | El idioma de las diapositivas, por ejemplo `en`. |
| `--in <carpeta>` | la carpeta de charlas | La carpeta donde queda la charla nueva. Escribe la ruta completa. |
| `--folder <nombre>` | `charla-<título>` | El nombre de la carpeta de la charla. |
| `--json` | | Escribe el resultado como JSON. |

## Comandos para una charla

`<charla>` es el nombre que da `studio talks`, por ejemplo `charla-git`. El prefijo `charla-` es
opcional. `<diapositiva>` es el nombre o el número de una diapositiva en `studio <charla> list`.

| Comando | Resultado |
| --- | --- |
| `studio <charla> list` | Lista las diapositivas con su estado. Es el comando por defecto. |
| `studio <charla> status` | Escribe el estado de la charla como JSON. |
| `studio <charla> info [--json]` | Muestra los campos de `talk.manimrs`. |
| `studio <charla> info --<campo> "<valor>"` | Cambia campos de `talk.manimrs`: `title`, `about`, `author`, `language`, `resolution`. |
| `studio <charla> forget` | Quita la charla de la lista. Los archivos de la charla no cambian. |
| `studio <charla> render <diapositiva>...` | Renderiza solo esas diapositivas. |
| `studio <charla> render --pending` | Renderiza las diapositivas que no están al día. |
| `studio <charla> render --all` | Renderiza todas las diapositivas. |
| `studio <charla> present [<diapositiva>]` | Presenta las diapositivas que tienen video, desde `<diapositiva>`. |
| `studio <charla> export [--pdf]` | Hace el paquete HTML y su `.zip`, o un PDF con una página por pausa. |
| `studio <charla> export --mp4 [<diapositiva>]` | Hace un video de la charla, o de una diapositiva. Un bucle se reproduce una vez. |
| `studio <charla> export --gif <diapositiva>` | Hace un GIF de una diapositiva, de 960 píxeles de ancho. |
| `studio <charla> stills <diapositiva> [--width <píxeles>]` | Hace una imagen PNG del final de cada pausa. |
| `studio <charla> notes` | Lista los cambios pedidos en la revisión. |
| `studio <charla> note <diapositiva> "<texto>"` | Escribe una petición de cambio para la diapositiva. |
| `studio <charla> note <diapositiva> --approve` | Aprueba la diapositiva. |
| `studio <charla> note <diapositiva> --clear` | Quita la revisión de la diapositiva. |
| `studio <charla> new "<nombre>" [--after <diapositiva>]` | Crea, registra y pone una diapositiva nueva en la charla. |
| `studio <charla> place slide_<nombre> [--after <diapositiva>]` | Pone en `main.py` una diapositiva ya registrada. |
| `studio <charla> move <diapositiva> --after <diapositiva>` | Mueve una diapositiva. Usa `--first` para dejarla de primera. |
| `studio <charla> rename <diapositiva> "<nombre nuevo>"` | Renombra una diapositiva y sus videos. |
| `studio <charla> duplicate <diapositiva> ["<nombre nuevo>"]` | Hace una copia de una diapositiva después de ella. Sin nombre, la copia es `<diapositiva>_copy`. |
| `studio <charla> restore <diapositiva>` | Quita el comentario de la llamada de una diapositiva en `main.py`. |
| `studio <charla> delete <diapositiva>` | Quita una diapositiva. Su archivo va a la papelera. |
| `studio <charla> resolution <diapositiva> <valor>` | Fija la resolución de una diapositiva: `480p`, `720p`, `1080p` o `default`. |

Opciones para una charla:

| Opción | Comandos | Resultado |
| --- | --- | --- |
| `--quality 480p\|720p\|1080p` | `render` | La resolución del render. Por defecto es la de la charla. Una diapositiva con resolución propia la conserva. |
| `--line <número>` | `move`, `rename`, `restore`, `delete`, `resolution` | Elige la diapositiva por su línea en `main.py` (desde 0). También sirve para una diapositiva comentada. |
| `--json` | `info`, `new`, `talks`, `open`, `new-talk` | Escribe el resultado como JSON. |

## Ejemplos

Renderizar dos diapositivas a 480p:

```powershell
.\studio git render 3 git_diff --quality 480p
```

Agregar una diapositiva después de `git_diff`:

```powershell
.\studio git new "git stash" --after git_diff
```

## Errores

Si un comando no puede hacer su trabajo, escribe `Error:` y la causa, y termina con un código
distinto de cero. El motor no cambia archivos cuando la entrada no es correcta.

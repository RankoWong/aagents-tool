# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**m4b-tool** is a PHP 8.2+ command-line tool for manipulating audiobook files. It acts as a wrapper around `ffmpeg` and `mp4v2` to merge, split, and manipulate audiobook files with chapter support. While designed for M4B files, it supports various audio formats (MP3, AAC, OGG, ALAC, FLAC).

The project includes:
- **CLI tool**: Command-line interface for audiobook manipulation
- **Web interface**: Browser-based UI at `web/` with REST API
- **macOS app**: Native application (AudioAgent.app) with embedded web UI

### Entry Points
- Main executable: `bin/m4b-tool.php`
- Shell wrapper: `m4b-tool.sh` (handles Homebrew PHP paths on macOS)
- Phar build output: `dist/m4b-tool.phar`
- Web interface: `web/index.html` (served via `web/api.php`)
- macOS app: `build/AudioAgent.app` (built via `make-app.sh`)
- PSR-4 autoloading namespace: `M4bTool\` -> `src/library/`

## Build and Development Commands

### Standard Development (Composer)

```bash
# Install dependencies
composer install

# Run tests
./vendor/bin/phpunit

# Build Phar archive
./build

# Build with plugins enabled
./build --with-plugins
```

### Nix Development (Recommended)

The project has excellent Nix support via Flakes:

```bash
# Enter development shell (installs all dependencies including ffmpeg, mp4v2)
nix develop

# Build the project
nix build

# Build with libfdk_aac encoder (higher quality)
nix build .#m4b-tool-libfdk

# Run the tool
nix run

# After updating dependencies, regenerate Nix files
composer2nix --executable --composition=composer.nix
```

### Docker Development

```bash
# Development container
docker-compose up m4b-tool-dev

# Use official image
docker run -it --rm -v "$(pwd)":/mnt sandreas/m4b-tool:latest
```

### Web Interface Development

```bash
# Start local PHP development server
php -S localhost:8080 -t web

# Access at http://localhost:8080
# The web interface provides a GUI for merge/split operations
```

### macOS Application Development

```bash
# Build the macOS app (requires Swift compiler)
./make-app.sh

# The app is built to: build/AudioAgent.app
# Double-click to run, or copy to /Applications/
```

**App Architecture:**
- **Swift + WKWebView**: Native macOS app with embedded web UI
- **M4BToolApp.swift**: Main application code (window management, PHP server control)
- **Embedded resources**: Web files and m4b-tool.sh bundled in app
- **Auto-port selection**: Tries ports 8080-8084 to avoid conflicts
- **Lifecycle management**: Automatically starts/stops PHP server with app

**Development Workflow:**
- Modify web files in `web/` → refresh app (no rebuild needed)
- Modify Swift code → rebuild with `./make-app.sh`
- Debug via Console.app or terminal output

### Shell Wrapper (m4b-tool.sh)

The `m4b-tool.sh` script provides a convenience wrapper around the main PHP executable with macOS-specific optimizations:

**Key Features:**
- **Homebrew PHP Detection**: Automatically finds and uses PHP from `/opt/homebrew/bin/php`
- **PATH Configuration**: Sets proper PATH for Homebrew installations
- **Project Directory Awareness**: Executes from correct directory regardless of CWD
- **Error Handling**: Better error messages and output redirection

**Usage:**
```bash
# Direct execution
./m4b-tool.sh merge --output-file="output.m4b" "input/"

# Or via the main PHP executable
/opt/homebrew/bin/php bin/m4b-tool.php merge ...
```

**When to use:**
- Use `m4b-tool.sh` for macOS development (handles Homebrew paths)
- Use `bin/m4b-tool.php` directly when PHP is in system PATH
- Use `dist/m4b-tool.phar` for production deployment (standalone)

## Architecture

### High-Level Structure

The codebase follows a clean architecture with Symfony Console:

```
m4b-tool/
├── bin/m4b-tool.php           # CLI entry point
├── m4b-tool.sh                # Shell wrapper with Homebrew PHP support
├── src/library/               # Main application code (PSR-4 autoload)
│   ├── Command/               # Symfony Console commands
│   ├── Audio/                 # Audio processing logic
│   │   └── Tag/              # Metadata handlers for different formats
│   ├── Executables/          # Wrappers for external tools (ffmpeg, mp4v2)
│   ├── Executables/Tasks/    # Task execution for parallel processing
│   ├── Chapter/              # Chapter detection and manipulation
│   ├── Filesystem/           # File/directory operations
│   ├── Parser/               # File format parsers
│   ├── Tags/                 # Tag handling utilities
│   └── Common/               # Shared utilities
├── web/                       # Web interface and API
│   ├── index.html            # Single-page application UI
│   ├── api.php               # REST API backend
│   ├── assets/               # CSS and JavaScript
│   ├── uploads/              # Temporary file storage
│   ├── output/               # Processed files
│   └── logs/                 # API and operation logs
├── tests/                    # PHPUnit tests
├── tools/                    # Utility scripts
├── make-app.sh               # macOS app build script
├── M4BToolApp.swift          # macOS app source code
└── build/                    # Build output (including .app bundle)
```

### Core Components

#### Commands (`src/library/Command/`)
- **MergeCommand**: Combines multiple audio files into single M4B
- **SplitCommand**: Splits M4B files by chapters or cue sheets
- **ChaptersCommand**: Handles chapter manipulation and detection
- **MetaCommand**: Manages metadata operations
- **AbstractCommand**: Base class with common functionality

All commands extend `AbstractCommand` which provides:
- Dependency injection container
- Logging via Monolog
- Process execution handling
- Common option parsing

#### Audio Processing (`src/library/Audio/`)
- **Chapter/ChapterHandler**: Core chapter management, silence detection
- **Tag/**: Multiple format adapters (Mp4, Mp3, Ogg, Flac, etc.)
- **ChapterCollection**: Data structure for chapter data
- Uses traits in `Audio/Traits/` for shared functionality

#### External Tool Integration (`src/library/Executables/`)
- **Ffmpeg**: Main audio processing engine wrapper
- **Mp4v2Wrapper**: mp4v2 tools (mp4chaps, mp4art, mp4tags)
- **Fdkaac**: Optional high-quality AAC encoder
- **Process**: Process execution with timeout handling

#### Parallel Processing (`src/library/Executables/Tasks/`)
- Task-based parallel execution system
- Used by `--jobs` parameter for multi-core conversion
- Each task represents an independent ffmpeg operation

#### Chapter Handling (`src/library/Chapter/`)
- **ChapterHandler**: Silence detection for automatic chapters
- **ChapterGroup**: Groups consecutive chapters for batch operations
- **ChapterCollection**: Immutable collection with chapter operations
- **Metadata**: Chapter metadata from various sources (MusicBrainz, manual files, silence detection)

### Key Design Patterns

1. **Command Pattern**: Each CLI command is a separate Symfony Console command class
2. **Adapter Pattern**: Multiple metadata format adapters in `Audio/Tag/` namespace
3. **Strategy Pattern**: Different chapter detection strategies (silence, MusicBrainz, manual)
4. **Dependency Injection**: Constructor injection throughout for testability
5. **Immutable Data**: ChapterCollection and similar classes are immutable

## Important Implementation Notes

### External Dependencies
The tool requires system binaries:
- `ffmpeg` (required) - audio conversion
- `mp4v2` tools (required) - mp4chaps, mp4art, mp4tags for M4B manipulation
- `fdkaac` (optional) - high-efficiency AAC encoding for low bitrates

### Phar Build Configuration
- Configured via `box.json`
- Uses `humbug/box` for Phar compilation
- Excludes tests, docs, and dev dependencies
- Creates standalone executable at `dist/m4b-tool.phar`

### Testing
- PHPUnit 9.5 for testing
- Mockery for mocking
- VfsStream for filesystem mocking
- Test data in `tests/M4bTool/Audio/Tag/`

### Release Process
- Automated via GitHub Actions (`.github/workflows/release.yml`)
- Triggers on version tags (`v*`)
- Builds Phar, creates GitHub release, pushes Docker image
- Version substitution in `bin/m4b-tool.php` via `@package_version@` placeholder

### Environment Variables
- `M4B_TOOL_PLUGINS`: Enable specific plugins at runtime
- `M4B_TOOL_PROCESS_TIMEOUT`: Process execution timeout
- `M4B_TOOL_DISABLE_TONE`: Disable Tone integration

## Chapter Detection and Manipulation

One of the most complex features is chapter handling:

1. **Silence Detection**: Analyzes audio waveform to detect silence between chapters
2. **MusicBrainz Integration**: Fetches chapter metadata for known audiobooks
3. **Manual Chapters**: Reads `chapters.txt` files (format: `HH:MM:SS.mmm Chapter Title`)
4. **Chapter Adjustment**: Relocates misplaced chapters to nearest silence
5. **Auto-subchapters**: Splits long chapters using `--max-chapter-length` parameter

### Silence Detection Parameters
- `--silence-min-length`: Minimum silence duration in ms (default: 1750)
- `--silence-max-length`: Maximum silence duration in ms (default: 0 = unlimited)
- `--max-chapter-length`: Max chapter duration in seconds, can specify `desired,max` format

### Batch Processing
The `--batch-pattern` feature processes multiple audiobooks using directory structure as metadata:

```bash
m4b-tool merge --batch-pattern="input/%g/%a/%s/%p - %n/" --output-file="output/" "input/"
```

Placeholders: `%g` (genre), `%a` (artist), `%s` (series), `%p` (series-part), `%n` (name/title), etc.

## Common Issues and Solutions

### Audio Quality
- Default ffmpeg AAC encoder is decent, but `libfdk_aac` provides better quality
- For low bitrates (<= 32k), use `fdkaac` with `--audio-profile=aac_he`
- Use Docker image or custom ffmpeg build for `libfdk_aac` support

### iPod Compatibility
- iPods have 32-bit sampling rate limit (~27 hours at 22050Hz)
- Use `--adjust-for-ipod` to automatically downsample for long audiobooks

### Platform-Specific Issues
- Windows: Enable `mbstring` PHP extension for charset conversion
- File encoding issues: Use `--platform-charset` (e.g., `Windows-1252`)

## Code Conventions

- PSR-4 autoloading: Classes match directory structure
- Symfony Console components for CLI
- Monolog for logging (configure via `--logfile` and `--debug`)
- Type hints where applicable (PHP 8.2+)
- Immutable data structures for chapter/metadata collections
- Constructor injection for dependencies

## Adding New Commands

To add a new command:

1. Create class in `src/library/Command/` extending `AbstractCommand`
2. Implement `configure()` for command definition and options
3. Implement `execute()` for command logic
4. Register in `bin/m4b-tool.php` Application
5. Add tests in `tests/` directory

## Adding New Tag Formats

To add support for a new audio metadata format:

1. Create adapter in `src/library/Audio/Tag/` extending appropriate base class
2. Implement required interface methods (read/write cover, metadata, chapters)
3. Register in tag format detection logic
4. Add test cases in `tests/M4bTool/Audio/Tag/`

## Web Interface and API Architecture

### Overview

The web interface provides a user-friendly GUI for audiobook operations through a browser-based SPA (Single Page Application). It consists of:

- **Frontend**: `web/index.html` - Vue.js-inspired reactive UI with tabbed interface (Merge/Split)
- **Backend**: `web/api.php` - REST API handling file operations and task management
- **Assets**: `web/assets/` - CSS and JavaScript for the UI

### API Endpoints

The REST API in `web/api.php` provides these endpoints:

**File Operations:**
- `POST /api.php?action=upload` - Upload audio files (creates unique task ID)
- `POST /api.php?action=upload_paths` - Native file path injection (for macOS app)
- `GET /api.php?action=task_info` - Get task details and file list

**Processing Operations:**
- `POST /api.php?action=merge` - Start merge operation with optional metadata
- `POST /api.php?action=split` - Start split operation by chapters
- `GET /api.php?action=status` - Check task progress (parses log files)

**Management Operations:**
- `GET /api.php?action=download` - Download processed files
- `GET /api.php?action=view_logs` - View operation logs
- `POST /api.php?action=delete` - Clean up task files

### Task Management System

The web interface uses an asynchronous task-based processing model:

1. **Upload**: Files uploaded to `web/uploads/{task_id}/` with unique task ID
2. **Process**: Background execution via `nohup` for long-running operations
3. **Monitor**: Progress tracked by parsing log files in `web/logs/`
4. **Output**: Results stored in `web/output/{task_id}/`
5. **Download**: Users download processed files, then clean up

**Task Lifecycle:**
```
Upload → Processing (background) → Monitoring → Complete → Download → Cleanup
```

### File Storage Structure

```
web/
├── uploads/           # Temporary upload storage (per task)
│   └── task_{id}/    # Auto-cleanup after download
├── output/           # Processed files (per task)
│   └── task_{id}/
└── logs/             # API and operation logs (daily rotation)
    ├── api_2026-01-24.log
    └── task_{id}.log
```

### Asynchronous Processing Pattern

The API uses `nohup` for background processing:

```php
$cmd = "nohup /path/to/m4b-tool.sh merge ... > $logfile 2>&1 &";
exec($cmd);
```

**Progress Tracking:**
- Log files parsed for progress indicators (% complete)
- Status endpoint returns current state (processing/complete/error)
- Frontend polls status endpoint periodically

### macOS App Integration

The native macOS app (`M4BToolApp.swift`) integrates with the web interface through:

1. **File Picker Injection**: Native macOS file picker passes selected paths to web UI via `upload_paths` endpoint
2. **Embedded Server**: PHP server runs within app process on dynamic port (8080-8084)
3. **Download Management**: Processed files automatically saved to ~/Downloads
4. **WebView Communication**: JavaScript bridge for native file operations

**Key Swift Components:**
- `WKWebView` - Embeds web interface in native window
- `Process` - Manages PHP server lifecycle
- `NSUserInterfaceItemIdentification` - Window state persistence
- Port detection logic - Finds available port on startup

### Development Workflow for Web Interface

**Local Development:**
```bash
# Start PHP server
php -S localhost:8080 -t web

# Access at http://localhost:8080
# Upload files, process, download results
```

**Debugging:**
- API logs: `tail -f web/logs/api_*.log`
- Task logs: `tail -f web/logs/task_*.log`
- Browser DevTools for frontend debugging

**Modifying UI:**
1. Edit `web/index.html` for structure
2. Edit `web/assets/css/style.css` for styling
3. Edit `web/assets/js/app.js` for behavior
4. Refresh browser to see changes

**Modifying API:**
1. Edit `web/api.php`
2. Restart PHP server (Ctrl+C, then `php -S localhost:8080 -t web`)
3. Test with cURL or frontend

### Security Considerations

**Web Interface:**
- File uploads restricted to audio formats (mp3, m4a, m4b, etc.)
- Output filenames sanitized to prevent path traversal
- Task IDs randomized (uniqid) to prevent enumeration
- CORS enabled for local development

**macOS App:**
- `NSAppTransportSecurity` configured in Info.plist for local networking
- Local server only (no external exposure)
- File paths validated before processing
- No privileged operations (user-space only)

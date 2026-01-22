# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**m4b-tool** is a PHP 8.2+ command-line tool for manipulating audiobook files. It acts as a wrapper around `ffmpeg` and `mp4v2` to merge, split, and manipulate audiobook files with chapter support. While designed for M4B files, it supports various audio formats (MP3, AAC, OGG, ALAC, FLAC).

### Entry Points
- Main executable: `bin/m4b-tool.php`
- Phar build output: `dist/m4b-tool.phar`
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

## Architecture

### High-Level Structure

The codebase follows a clean architecture with Symfony Console:

```
m4b-tool/
├── bin/m4b-tool.php           # CLI entry point
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
├── tests/                    # PHPUnit tests
└── tools/                    # Utility scripts
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

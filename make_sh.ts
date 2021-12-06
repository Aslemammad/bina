import { archive_ext } from "./lib/archive_ext"
import { Platform } from "./types"

export const makeErrorScript = (error: string) => {
  return `
  #!/bin/sh

  NC='\\033[0m' # No Color
  RED='\\033[0;31m'

  set -e

  echoerr() {
    printf "$@\n" 1>&2
  }

  log_crit() {
    echoerr
    echoerr "  \${RED}server error: $@\${NC}"
    echoerr
  }

  log_crit ${JSON.stringify(error)}
  exit 1

  `
}

export const makeInstallerScript = ({
  original_version,
  resolved_version,
  api,
  repo,
  bin,
  platforms,
  token,
  debug,
  useAutoGeneratedConfig,
}: {
  original_version: string
  resolved_version: string
  api: string
  repo: { owner: string; name: string }
  bin: { name: string; installDir: string; fileInAsset?: string | null }
  platforms: Platform[]
  token?: string | null
  debug?: boolean
  useAutoGeneratedConfig: boolean
}) => {
  const whenDebug = (input: string) => {
    return debug ? input : ""
  }
  return `
  #!/bin/sh

  NC='\\033[0m' # No Color
  BRIGHT_BLUE='\\033[0;94m'
  YELLOW='\\033[0;33m'
  RED='\\033[0;31m'

  set -e
  
  # Some utilities from https://github.com/client9/shlib

  echoerr() {
    printf "$@\n" 1>&2
  }
  
  log_info() {
    printf "\${BRIGHT_BLUE}  ==>\${NC} $@\n"
    exit 0
  }

  log_warn() {
    printf "\${YELLOW}  ==>\${NC} $@\n"
  }
  
  log_crit() {
    echoerr
    echoerr "  \${RED}$@\${NC}"
    echoerr
  }
  
  is_command() {
    command -v "$1" >/dev/null
    #type "$1" > /dev/null 2> /dev/null
  }
  
  http_download_curl() {
    local_file=$1
    source_url=$2
    header1=$3
    header2=$4
    header3=$5

    code=$(curl ${whenDebug(
      `-v`
    )} -w '%{http_code}' -H "$header1" -H "$header2" -H "$header3" -fsSL -o "$local_file" "$source_url")
    if [ "$code" != "200" ]; then
      log_crit "Error downloading, got $code response from server"
      return 1
    fi
    return 0
  }

  uname_os() {
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
  
    # fixed up for https://github.com/client9/shlib/issues/3
    case "$os" in
      msys_nt*) os="windows" ;;
      mingw*) os="windows" ;;
    esac
  
    # other fixups here
    echo "$os"
  }
  
  uname_os_check() {
    os=$(uname_os)
    case "$os" in
      darwin) return 0 ;;
      dragonfly) return 0 ;;
      freebsd) return 0 ;;
      linux) return 0 ;;
      android) return 0 ;;
      nacl) return 0 ;;
      netbsd) return 0 ;;
      openbsd) return 0 ;;
      plan9) return 0 ;;
      solaris) return 0 ;;
      windows) return 0 ;;
    esac
    log_crit "uname_os_check '$(uname -s)' got converted to '$os' which is not supported by Bina."
    return 1
  }
  
  uname_arch() {
    arch=$(uname -m)
    case $arch in
      x86_64) arch="amd64" ;;
      x86) arch="386" ;;
      i686) arch="386" ;;
      i386) arch="386" ;;
      aarch64) arch="arm64" ;;
      armv5*) arch="armv5" ;;
      armv6*) arch="armv6" ;;
      armv7*) arch="armv7" ;;
    esac
    echo \${arch}
  }
  
  uname_arch_check() {
    arch=$(uname_arch)
      case "$arch" in
      386) return 0 ;;
      amd64) return 0 ;;
      arm64) return 0 ;;
      armv5) return 0 ;;
      armv6) return 0 ;;
      armv7) return 0 ;;
      ppc64) return 0 ;;
      ppc64le) return 0 ;;
      mips) return 0 ;;
      mipsle) return 0 ;;
      mips64) return 0 ;;
      mips64le) return 0 ;;
      s390x) return 0 ;;
      amd64p32) return 0 ;;
    esac
    log_crit "uname_arch_check '$(uname -m)' got converted to '$arch' which is not supported by Bina."
    return 1
  }

  platform_check() {
    platform="$os-$arch"
    case "$platform" in
      ${platforms
        .map((p) => {
          return `${p.platform}) 
          download_url="${p.asset.url}" 
          download_file_name="${p.asset.name}"
          bin_file="${bin.fileInAsset || p.file}"
          ;;`
        })
        .join("\n")}
      *)
      log_crit "platform $platform is not supported by $repo_url."
      exit 1
      ;;
    esac
  }

  #
  # untar: untar or unzip $1
  #
  # if you need to unpack in specific directory use a
  # subshell and cd
  #
  # (cd /foo && untar mytarball.gz)
  #
  untar() {
    tarball=$1
    case "\${tarball}" in
      ${archive_ext
        .filter((v) => v !== ".zip")
        .map((v) => `*${v}`)
        .join(" | ")}) tar -xzf "\${tarball}" ;;
      *.zip) unzip -qj "\${tarball}" ;;
      *)
        log_crit "untar unknown archive format for \${tarball}"
        return 1
        ;;
    esac
  }

  
  mktmpdir() {
    TMPDIR="$(mktemp -d)"
    mkdir -p "\${TMPDIR}"
    echo "\${TMPDIR}"
  }

  abspath() {
    local old=$PWD
    cd $1
    local temp=$PWD
    cd $old
    echo $temp
  }
  
  start() {
    repo="${repo.owner}/${repo.name}"
    # github repo such as "github.com/egoist/doko"
    repo_url="github.com/$repo"
  
    uname_os_check
    uname_arch_check
    platform_check

    mkdir -p "${bin.installDir}"
    install_dir=$(abspath "${bin.installDir}")
    bin_name="${bin.name}"
    github_token="$GITHUB_TOKEN"
    ${token ? `github_token="${token}"` : ``}
  
    # API endpoint such as "http://localhost:3000"
    api="${api}"

    # original_version such as "latest"
    original_version="${original_version}"
  
    # version such as "master"
    version="${resolved_version}"
    
    tmpdir="$(mktmpdir)"

    bin_dest="$tmpdir/$bin_name"
    tmp="$tmpdir/$download_file_name"
  
    echo

    ${
      useAutoGeneratedConfig
        ? `
    log_warn "Using auto generated config because $repo doesn't have a bina.json file in its release"
    log_warn "This might not work for some projects"
    `
        : ""
    } 
    if [ "$original_version" != "$version" ]; then
      log_info "Resolved version $original_version to $version"
    fi
    log_info "Downloading asset for $os $arch"

    if [ -n "$github_token" ]; then
      auth_header="Authorization: token $github_token"
    fi

    http_download_curl "$tmp" "$download_url" "accept: application/octet-stream" "$auth_header"

    ${whenDebug(`echo "temp dir: $tmpdir"`)}
    ${whenDebug(`echo "temp file: $tmp"`)}

    # Extract
    cd "$tmpdir"
    untar "$tmp"

    # If the archive extracts to a directory with the same name, cd into it
    folder_name="$tmp"
    # Remove extension from the name
    ${archive_ext
      .map((ext) => {
        return `folder_name="$(basename "$folder_name" ${ext})"`
      })
      .join("\n")}
    ${whenDebug(`echo "checking if folder $folder_name exists"`)}
    if [ -d "$folder_name" ]; then
      ${whenDebug(`echo "folder $folder_name exists"`)}
      cd "$folder_name"
    fi

    if [ -w "$install_dir" ]; then
      log_info "Installing $bin_name to $install_dir"
      install "$bin_file" "$install_dir"
    else
      log_warn "Permissions required for installation to $install_dir"
      sudo install "$bin_file" "$install_dir"
    fi
  
    log_info "Installation complete"
    echo
  }
  
  start  
  `
}

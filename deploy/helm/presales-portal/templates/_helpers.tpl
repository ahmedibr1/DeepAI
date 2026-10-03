{{- define "pp.name" -}}presales-portal{{- end -}}
{{- define "pp.fullname" -}}{{ .Release.Name }}-presales-portal{{- end -}}

{{- define "pp.labels" -}}
app.kubernetes.io/name: {{ include "pp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "pp.selector" -}}
app.kubernetes.io/name: {{ include "pp.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "pp.image" -}}
{{- $registry := .root.Values.global.imageRegistry -}}
{{- if $registry }}{{ $registry }}/{{ end }}{{ .image.repository }}:{{ .image.tag }}
{{- end -}}

{{- define "pp.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  seccompProfile: { type: RuntimeDefault }
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{ toYaml . | indent 2 }}
{{- end }}
{{- end -}}

{{- define "pp.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: ["ALL"] }
{{- end -}}
